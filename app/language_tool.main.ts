// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { ipcMain } from 'electron';
import z from 'zod';

import {
  DEFAULT_ISSUE_TYPES,
  FALLBACK_LANGUAGES,
  MAX_GRAMMAR_CHECK_TEXT_LENGTH,
} from '../ts/types/LanguageTool.std.ts';
import type {
  GrammarCheckResponseType,
  GrammarIgnoreRequestType,
  LanguageToolStatusType,
  LanguageToolTestResultType,
} from '../ts/types/LanguageTool.std.ts';
import { LanguageToolClient } from '../ts/util/languageToolClient.node.ts';
import { createLogger } from '../ts/logging/log.std.ts';
import { ephemeralConfig } from './ephemeral_config.main.ts';
import { userConfig } from './user_config.main.ts';

const log = createLogger('language_tool');

const IGNORED_WORDS_CONFIG_KEY = 'languageToolIgnoredWords';
const DISABLED_RULES_CONFIG_KEY = 'languageToolDisabledRules';

const checkRequestSchema = z.object({
  text: z.string().max(MAX_GRAMMAR_CHECK_TEXT_LENGTH),
  language: z.string().min(1).max(35),
});

const ignoreRequestSchema = z.object({
  kind: z.enum(['word', 'rule']),
  value: z.string().min(1).max(200),
  language: z.string().max(35),
});

function getServerUrl(): string | undefined {
  const value = ephemeralConfig.get('language-tool-url');
  return typeof value === 'string' ? value : undefined;
}

function getIgnoredWordsMap(): Record<string, Array<string>> {
  const value = userConfig.get(IGNORED_WORDS_CONFIG_KEY);
  if (value == null || typeof value !== 'object') {
    return {};
  }

  const result: Record<string, Array<string>> = {};
  for (const [language, words] of Object.entries(value)) {
    if (!Array.isArray(words)) {
      continue;
    }
    result[language] = words.filter(
      (word): word is string => typeof word === 'string'
    );
  }

  return result;
}

function getDisabledRules(): ReadonlyArray<string> {
  const value = userConfig.get(DISABLED_RULES_CONFIG_KEY);
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((rule): rule is string => typeof rule === 'string');
}

function getIgnoredWords(language: string): ReadonlyArray<string> {
  return getIgnoredWordsMap()[language] ?? [];
}

const client = new LanguageToolClient({
  getServerUrl,
  // LanguageTool's style rules are noisy for chat; they stay off.
  getIncludeStyleRules: () => false,
  getDisabledRules,
  getIgnoredWords,
  logger: log,
});

function addIgnoredWord(language: string, word: string): void {
  const map = getIgnoredWordsMap();
  const words = map[language] ?? [];
  if (!words.includes(word)) {
    map[language] = [...words, word];
    userConfig.set(IGNORED_WORDS_CONFIG_KEY, map);
  }
}

function addDisabledRule(ruleId: string): void {
  const rules = getDisabledRules();
  if (!rules.includes(ruleId)) {
    userConfig.set(DISABLED_RULES_CONFIG_KEY, [...rules, ruleId]);
  }
}

export function ignoreSuggestion(request: GrammarIgnoreRequestType): void {
  if (request.kind === 'word') {
    addIgnoredWord(request.language, request.value);
  } else {
    addDisabledRule(request.value);
  }

  client.clearCache();
}

export function registerLanguageToolIpc(): void {
  ipcMain.handle(
    'LanguageTool:check',
    async (event, rawRequest): Promise<GrammarCheckResponseType> => {
      if (event.senderFrame == null) {
        return { ok: false, error: 'invalidEndpoint' };
      }

      const parsed = checkRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return { ok: false, error: 'textTooLong' };
      }

      return client.check(parsed.data);
    }
  );

  ipcMain.handle(
    'LanguageTool:status',
    async (): Promise<LanguageToolStatusType> => {
      const endpoint = client.getEndpoint();
      if (!endpoint.ok) {
        // A malformed or insecure URL is a configuration problem, not a
        // network one; report it the same way as "nothing configured" so the
        // UI does not claim the server is unreachable.
        const isConfigError =
          endpoint.error === 'unconfigured' ||
          endpoint.error === 'invalidEndpoint' ||
          endpoint.error === 'insecureEndpoint';

        return {
          state: isConfigError ? 'unconfigured' : 'error',
          error: endpoint.error,
          languages: FALLBACK_LANGUAGES,
        };
      }

      const languages = await client.getLanguages();
      if (languages.length === 0) {
        return {
          state: 'error',
          error: 'unreachable',
          languages: FALLBACK_LANGUAGES,
        };
      }

      return { state: 'ready', languages };
    }
  );

  ipcMain.handle(
    'LanguageTool:test',
    async (_event, rawUrl: unknown): Promise<LanguageToolTestResultType> => {
      if (typeof rawUrl !== 'string' || rawUrl.length > 2048) {
        return { ok: false, error: 'invalidEndpoint' };
      }
      return client.testConnection(rawUrl);
    }
  );

  ipcMain.handle('LanguageTool:ignore', async (_event, rawRequest) => {
    const parsed = ignoreRequestSchema.safeParse(rawRequest);
    if (!parsed.success) {
      return;
    }

    ignoreSuggestion(parsed.data);
  });

  ipcMain.handle(
    'LanguageTool:getIgnored',
    async (): Promise<{
      words: Record<string, ReadonlyArray<string>>;
      rules: ReadonlyArray<string>;
    }> => {
      return { words: getIgnoredWordsMap(), rules: getDisabledRules() };
    }
  );

  log.info(
    `language_tool: registered, ${
      getServerUrl() ? 'server configured' : 'no server configured'
    }, issueTypes=${DEFAULT_ISSUE_TYPES.join(',')}`
  );
}
