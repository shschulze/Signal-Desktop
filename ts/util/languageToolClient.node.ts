// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { createHash } from 'node:crypto';

import got, { AbortError, HTTPError, RequestError, TimeoutError } from 'got';
import { LRUCache } from 'lru-cache';
import PQueue from 'p-queue';

import {
  GRAMMAR_CHECK_TIMEOUT_MS,
  LT_CHECK_RESPONSE_SCHEMA,
  LT_LANGUAGES_RESPONSE_SCHEMA,
  MAX_GRAMMAR_CHECK_TEXT_LENGTH,
} from '../types/LanguageTool.std.ts';
import type {
  DetectedLanguageType,
  GrammarCheckErrorType,
  GrammarCheckRequestType,
  GrammarCheckResponseType,
  GrammarMatchType,
  LanguageToolLanguageType,
  LanguageToolTestResultType,
} from '../types/LanguageTool.std.ts';
import type {
  EndpointResultType,
  ResolvedEndpointType,
} from './languageToolEndpoint.std.ts';
import { buildApiUrl, resolveEndpoint } from './languageToolEndpoint.std.ts';
import { safeParseUnknown } from './schemas.std.ts';
import type { LoggerType } from '../types/Logging.std.ts';

const LANGUAGES_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;

type CheckOutcomeType = Readonly<{
  matches: ReadonlyArray<GrammarMatchType>;
  detectedLanguage?: DetectedLanguageType;
}>;

export type LanguageToolClientOptionsType = Readonly<{
  getServerUrl: () => string | undefined;
  getIncludeStyleRules: () => boolean;
  /** Rules the user asked LanguageTool to skip, e.g. `EN_QUOTES`. */
  getDisabledRules: () => ReadonlyArray<string>;
  /** Words the user asked us to never flag, for the given language. */
  getIgnoredWords: (language: string) => ReadonlyArray<string>;
  logger: LoggerType;
}>;

function mapError(error: unknown): GrammarCheckErrorType {
  if (error instanceof HTTPError) {
    if (error.response.statusCode === 429) {
      return 'rateLimited';
    }
    if (error.response.statusCode >= 500) {
      return 'serverError';
    }
    return 'badResponse';
  }
  if (
    error instanceof TimeoutError ||
    error instanceof AbortError ||
    error instanceof RequestError
  ) {
    return 'unreachable';
  }
  return 'badResponse';
}

/**
 * Talks to a user-configured LanguageTool server.
 *
 * Draft text must never be logged, cached to disk, or sent anywhere but the
 * configured endpoint. Only sizes, languages and latencies are logged.
 */
export class LanguageToolClient {
  readonly #options: LanguageToolClientOptionsType;

  readonly #queue = new PQueue({ concurrency: 1 });

  readonly #cache = new LRUCache<string, CheckOutcomeType>({
    max: MAX_CACHE_ENTRIES,
  });

  #abortController: AbortController | undefined;
  #requestId = 0;

  #languages: ReadonlyArray<LanguageToolLanguageType> | undefined;
  #languagesFetchedAt = 0;

  constructor(options: LanguageToolClientOptionsType) {
    this.#options = options;
  }

  /**
   * The configured endpoint, or the reason the configured value is unusable.
   */
  public getEndpoint(): EndpointResultType {
    return resolveEndpoint(this.#options.getServerUrl());
  }

  public async check(
    request: GrammarCheckRequestType
  ): Promise<GrammarCheckResponseType> {
    const { text, language } = request;

    if (text.length === 0) {
      return { ok: true, matches: [] };
    }
    if (text.length > MAX_GRAMMAR_CHECK_TEXT_LENGTH) {
      return { ok: false, error: 'textTooLong' };
    }

    const endpointResult = this.getEndpoint();
    if (!endpointResult.ok) {
      return { ok: false, error: endpointResult.error };
    }

    const cacheKey = createHash('sha256')
      .update(endpointResult.endpoint.baseUrl)
      .update('\u0000')
      .update(language)
      .update('\u0000')
      .update(this.#options.getDisabledRules().join(','))
      .update('\u0000')
      .update(this.#options.getIgnoredWords(language).join(','))
      .update('\u0000')
      .update(text)
      .digest('base64');

    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) {
      return { ok: true, ...cached };
    }

    const requestId = this.#nextRequestId();
    const controller = new AbortController();
    this.#abortController = controller;

    try {
      const outcome = await this.#queue.add(() =>
        this.#runCheck(endpointResult.endpoint, request, controller.signal)
      );

      if (outcome === undefined) {
        // Superseded by a newer request; the caller drops it by request id.
        return { ok: true, matches: [] };
      }
      if (requestId !== this.#requestId) {
        return { ok: true, matches: [] };
      }

      this.#cache.set(cacheKey, outcome);
      return { ok: true, ...outcome };
    } catch (error) {
      const mapped = mapError(error);
      this.#options.logger.info(
        `language_tool: check failed (${mapped}), ` +
          `chars=${text.length}, lang=${language}`
      );
      return { ok: false, error: mapped };
    }
  }

  public async getLanguages(): Promise<
    ReadonlyArray<LanguageToolLanguageType>
  > {
    const now = Date.now();
    if (
      this.#languages !== undefined &&
      now - this.#languagesFetchedAt < LANGUAGES_TTL_MS
    ) {
      return this.#languages;
    }

    const endpointResult = this.getEndpoint();
    if (!endpointResult.ok) {
      return [];
    }

    try {
      const json: unknown = await got
        .get(buildApiUrl(endpointResult.endpoint, '/v2/languages'), {
          timeout: { request: GRAMMAR_CHECK_TIMEOUT_MS },
          retry: { limit: 0 },
          headers: { Accept: 'application/json' },
          responseType: 'json',
        })
        .json();

      const languages = safeParseUnknown(LT_LANGUAGES_RESPONSE_SCHEMA, json);
      if (!languages.success) {
        return [];
      }

      this.#languages = languages.data;
      this.#languagesFetchedAt = now;
      return languages.data;
    } catch (error) {
      this.#options.logger.info(
        `language_tool: languages request failed (${mapError(error)})`
      );
      return [];
    }
  }

  public async testConnection(
    rawUrl: string
  ): Promise<LanguageToolTestResultType> {
    const endpointResult = resolveEndpoint(rawUrl);
    if (!endpointResult.ok) {
      return { ok: false, error: endpointResult.error };
    }

    try {
      await got.get(buildApiUrl(endpointResult.endpoint, '/v2/languages'), {
        timeout: { request: GRAMMAR_CHECK_TIMEOUT_MS },
        retry: { limit: 0 },
        headers: { Accept: 'application/json' },
        responseType: 'json',
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: mapError(error) };
    }
  }

  public clearCache(): void {
    this.#cache.clear();
    this.#languages = undefined;
    this.#languagesFetchedAt = 0;
  }

  #nextRequestId(): number {
    this.#requestId += 1;

    // Only the most recent request matters; anything still in flight would be
    // showing results for text the user has already changed.
    this.#abortController?.abort();

    return this.#requestId;
  }

  async #runCheck(
    endpoint: ResolvedEndpointType,
    request: GrammarCheckRequestType,
    signal: AbortSignal
  ): Promise<CheckOutcomeType | undefined> {
    const includeStyleRules = this.#options.getIncludeStyleRules();
    const disabledRules = this.#options.getDisabledRules();

    const json: unknown = await got
      .post(buildApiUrl(endpoint, '/v2/check'), {
        form: {
          text: request.text,
          language: request.language,
          enabledOnly: 'false',
          level: 'default',
          ...(disabledRules.length > 0
            ? { disabledRules: disabledRules.join(',') }
            : {}),
        },
        timeout: { request: GRAMMAR_CHECK_TIMEOUT_MS },
        retry: { limit: 0 },
        headers: { Accept: 'application/json' },
        responseType: 'json',
        signal,
      })
      .json();

    const parsed = safeParseUnknown(LT_CHECK_RESPONSE_SCHEMA, json);
    if (!parsed.success) {
      throw new Error('LanguageTool returned an unexpected response');
    }

    const detected = parsed.data.language?.detectedLanguage;
    const detectedLanguage: DetectedLanguageType | undefined = detected
      ? { name: detected.name, code: detected.code }
      : undefined;

    // "Ignore word" entries are stored per language, and with auto-detection
    // the language we asked for is not the one that was checked.
    const ignoredWords = new Set(
      this.#options
        .getIgnoredWords(detected?.code ?? request.language)
        .map(word => word.normalize('NFC').toLowerCase())
    );

    const matches: Array<GrammarMatchType> = [];
    for (const match of parsed.data.matches) {
      const issueType = match.rule.issueType ?? 'uncategorized';
      if (!includeStyleRules && issueType === 'style') {
        continue;
      }

      if (ignoredWords.size > 0) {
        const flagged = request.text
          .slice(match.offset, match.offset + match.length)
          .normalize('NFC')
          .toLowerCase();
        if (ignoredWords.has(flagged)) {
          continue;
        }
      }

      matches.push({
        message: match.message,
        shortMessage: match.shortMessage,
        replacements: match.replacements.map(({ value }) => value),
        offset: match.offset,
        length: match.length,
        ruleId: match.rule.id,
        ruleDescription: match.rule.description,
        issueType,
      });
    }

    return { matches, detectedLanguage };
  }
}
