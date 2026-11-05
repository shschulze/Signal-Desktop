// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import z from 'zod';

/**
 * The maximum number of characters we will ever send to a LanguageTool server.
 *
 * Message bodies are limited to 2 KiB of UTF-8 (`MAX_MESSAGE_BODY_BYTE_LENGTH`),
 * so this only exists to defend against bugs and against other composers that
 * may use a larger limit.
 */
export const MAX_GRAMMAR_CHECK_TEXT_LENGTH = 2048;

/** Upper bound for a single check request, enforced in the main process. */
export const GRAMMAR_CHECK_TIMEOUT_MS = 5000;

export const LT_LANGUAGE_SCHEMA = z.object({
  name: z.string(),
  code: z.string(),
  longCode: z.string(),
});

export type LanguageToolLanguageType = Readonly<
  z.infer<typeof LT_LANGUAGE_SCHEMA>
>;

const LT_REPLACEMENT_SCHEMA = z.object({
  value: z.string(),
});

const LT_RULE_SCHEMA = z.object({
  id: z.string(),
  description: z.string(),
  issueType: z.string().optional(),
  category: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .optional(),
});

const LT_MATCH_SCHEMA = z.object({
  message: z.string(),
  shortMessage: z.string().optional(),
  replacements: z.array(LT_REPLACEMENT_SCHEMA),
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  rule: LT_RULE_SCHEMA,
});

/** Sent as `language=` when the server should work out the language itself. */
export const AUTO_DETECT_LANGUAGE = 'auto';

const LT_DETECTED_LANGUAGE_SCHEMA = z.object({
  name: z.string(),
  code: z.string(),
  confidence: z.number().optional(),
  source: z.string().optional(),
});

const LT_RESPONSE_LANGUAGE_SCHEMA = z.object({
  name: z.string(),
  code: z.string(),
  detectedLanguage: LT_DETECTED_LANGUAGE_SCHEMA.optional(),
});

export const LT_CHECK_RESPONSE_SCHEMA = z.object({
  matches: z.array(LT_MATCH_SCHEMA),
  language: LT_RESPONSE_LANGUAGE_SCHEMA.optional(),
});

export const LT_LANGUAGES_RESPONSE_SCHEMA = z.array(LT_LANGUAGE_SCHEMA);

/**
 * A single issue found in the draft, already normalised for the renderer.
 *
 * `offset` and `length` index into the plain text produced by
 * `extractText()` in `ts/quill/grammar-check/mapping.std.ts`.
 */
export type GrammarMatchType = Readonly<{
  message: string;
  shortMessage?: string;
  replacements: ReadonlyArray<string>;
  offset: number;
  length: number;
  ruleId: string;
  ruleDescription: string;
  issueType: string;
}>;

export type GrammarCheckRequestType = Readonly<{
  text: string;
  /**
   * LanguageTool language code, e.g. `en-US`, or `AUTO_DETECT_LANGUAGE` to let
   * the server detect it from the text.
   */
  language: string;
}>;

export type GrammarIgnoreRequestType = Readonly<{
  kind: 'word' | 'rule';
  value: string;
  /** Only used when `kind` is `word`. */
  language: string;
}>;

export type GrammarCheckErrorType =
  | 'unconfigured'
  | 'invalidEndpoint'
  | 'insecureEndpoint'
  | 'textTooLong'
  | 'unreachable'
  | 'rateLimited'
  | 'serverError'
  | 'badResponse';

export type DetectedLanguageType = Readonly<{
  name: string;
  code: string;
}>;

export type GrammarCheckResponseType =
  | Readonly<{
      ok: true;
      matches: ReadonlyArray<GrammarMatchType>;
      /** Only present when the server was asked to detect the language. */
      detectedLanguage?: DetectedLanguageType;
    }>
  | Readonly<{ ok: false; error: GrammarCheckErrorType }>;

export type LanguageToolStatusType = Readonly<{
  state: 'unconfigured' | 'ready' | 'error';
  error?: GrammarCheckErrorType;
  languages: ReadonlyArray<LanguageToolLanguageType>;
}>;

export type LanguageToolTestResultType = Readonly<{
  ok: boolean;
  error?: GrammarCheckErrorType;
}>;

/**
 * Sent from the renderer just before a right-click so that the main process can
 * add grammar suggestions to the native context menu.
 */
export type GrammarContextHintType = Readonly<{
  message: string;
  replacements: ReadonlyArray<string>;
  ruleId: string;
  ruleDescription: string;
  /** The flagged word or phrase, used for "ignore word". */
  word: string;
  language: string;
  offset: number;
  length: number;
}>;

export type GrammarReplacementType = Readonly<{
  offset: number;
  length: number;
  value: string;
}>;

/** Commands sent from the main process to the composer. */
export type GrammarCommandType =
  | Readonly<{ type: 'recheck' }>
  | Readonly<{ type: 'replace'; replacement: GrammarReplacementType }>;

/**
 * Common LanguageTool languages, used to populate the language picker when the
 * configured server cannot be reached. Mirrors the `longCode` values returned
 * by `GET /v2/languages`.
 */
export const FALLBACK_LANGUAGES: ReadonlyArray<LanguageToolLanguageType> = [
  { name: 'Arabic', code: 'ar', longCode: 'ar' },
  { name: 'Bulgarian', code: 'bg', longCode: 'bg' },
  { name: 'Catalan', code: 'ca', longCode: 'ca-ES' },
  { name: 'Czech', code: 'cs', longCode: 'cs-CZ' },
  { name: 'Danish', code: 'da', longCode: 'da-DK' },
  { name: 'German', code: 'de', longCode: 'de-DE' },
  { name: 'German (Austria)', code: 'de-AT', longCode: 'de-AT' },
  { name: 'German (Switzerland)', code: 'de-CH', longCode: 'de-CH' },
  { name: 'Greek', code: 'el', longCode: 'el-GR' },
  { name: 'English', code: 'en', longCode: 'en-US' },
  { name: 'English (Australia)', code: 'en-AU', longCode: 'en-AU' },
  { name: 'English (Canada)', code: 'en-CA', longCode: 'en-CA' },
  { name: 'English (United Kingdom)', code: 'en-GB', longCode: 'en-GB' },
  { name: 'English (New Zealand)', code: 'en-NZ', longCode: 'en-NZ' },
  { name: 'English (South Africa)', code: 'en-ZA', longCode: 'en-ZA' },
  { name: 'Spanish', code: 'es', longCode: 'es' },
  { name: 'Persian', code: 'fa', longCode: 'fa' },
  { name: 'Finnish', code: 'fi', longCode: 'fi-FI' },
  { name: 'French', code: 'fr', longCode: 'fr' },
  { name: 'French (Canada)', code: 'fr-CA', longCode: 'fr-CA' },
  { name: 'Irish', code: 'ga', longCode: 'ga-IE' },
  { name: 'Galician', code: 'gl', longCode: 'gl-ES' },
  { name: 'Hebrew', code: 'he', longCode: 'he' },
  { name: 'Hindi', code: 'hi', longCode: 'hi-IN' },
  { name: 'Croatian', code: 'hr', longCode: 'hr-HR' },
  { name: 'Hungarian', code: 'hu', longCode: 'hu-HU' },
  { name: 'Italian', code: 'it', longCode: 'it' },
  { name: 'Japanese', code: 'ja', longCode: 'ja-JP' },
  { name: 'Korean', code: 'ko', longCode: 'ko-KR' },
  { name: 'Dutch', code: 'nl', longCode: 'nl' },
  { name: 'Norwegian (Bokmål)', code: 'nb', longCode: 'nb' },
  { name: 'Polish', code: 'pl', longCode: 'pl-PL' },
  { name: 'Portuguese (Brazil)', code: 'pt-BR', longCode: 'pt-BR' },
  { name: 'Portuguese (Portugal)', code: 'pt-PT', longCode: 'pt-PT' },
  { name: 'Romanian', code: 'ro', longCode: 'ro-RO' },
  { name: 'Russian', code: 'ru', longCode: 'ru-RU' },
  { name: 'Slovak', code: 'sk', longCode: 'sk-SK' },
  { name: 'Slovenian', code: 'sl', longCode: 'sl-SI' },
  { name: 'Swedish', code: 'sv', longCode: 'sv' },
  { name: 'Tamil', code: 'ta', longCode: 'ta-IN' },
  { name: 'Ukrainian', code: 'uk', longCode: 'uk-UA' },
  { name: 'Chinese', code: 'zh', longCode: 'zh-CN' },
];

/**
 * Issue types we surface by default. LanguageTool's style rules are noisy for
 * chat, so they are opt-in via `includeStyleRules`.
 */
export const DEFAULT_ISSUE_TYPES: ReadonlyArray<string> = [
  'misspelling',
  'grammar',
  'typographical',
  'duplication',
  'inconsistency',
];
