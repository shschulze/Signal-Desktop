// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { GrammarMatchType } from '../../types/LanguageTool.std.ts';

/**
 * LanguageTool's browser extension groups issues into four visible categories,
 * each with its own underline color. The server does not send the category, so
 * it has to be derived from the rule metadata.
 */
export type GrammarMatchCategoryType =
  | 'spelling'
  | 'grammar'
  | 'style'
  | 'recommendation';

export const GRAMMAR_MATCH_CATEGORIES: ReadonlyArray<GrammarMatchCategoryType> =
  ['spelling', 'grammar', 'style', 'recommendation'];

/** Rule ID fragments that identify spelling rules. */
const SPELLING_RULE_ID_PARTS = [
  'SPELLER_RULE',
  'MORFOLOGIK_RULE',
  'HUNSPELL',
  'SPELLING_RULE',
  'ORTHOGRAPHY',
];

/** Issue types that LanguageTool's add-on shows as style suggestions. */
const STYLE_ISSUE_TYPES = new Set(['style', 'locale-violation', 'register']);

export function categorizeGrammarMatch(
  match: Pick<GrammarMatchType, 'ruleId' | 'issueType'>
): GrammarMatchCategoryType {
  if (
    match.issueType === 'RECOMMENDATION' ||
    match.issueType === 'PHRASAL_RECOMMENDATION'
  ) {
    return 'recommendation';
  }
  if (SPELLING_RULE_ID_PARTS.some(part => match.ruleId.includes(part))) {
    return 'spelling';
  }
  if (STYLE_ISSUE_TYPES.has(match.issueType)) {
    return 'style';
  }
  return 'grammar';
}
