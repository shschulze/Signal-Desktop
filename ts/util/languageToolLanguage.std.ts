// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { FALLBACK_LANGUAGES } from '../types/LanguageTool.std.ts';
import { getLanguages } from './getLanguages.std.ts';

const DEFAULT_CHECK_LANGUAGE = 'en-US';

/**
 * Picks the LanguageTool language to check with.
 *
 * An explicit choice from the settings always wins. Otherwise the user's UI
 * locale is matched against the languages we know LanguageTool ships with.
 */
export function resolveCheckLanguage(
  configured: string | undefined,
  preferredLocales: ReadonlyArray<string>
): string {
  const trimmed = (configured ?? '').trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  const available = FALLBACK_LANGUAGES.map(({ longCode }) => longCode);
  const [matched] = getLanguages(
    preferredLocales,
    available,
    DEFAULT_CHECK_LANGUAGE
  );

  return matched ?? DEFAULT_CHECK_LANGUAGE;
}
