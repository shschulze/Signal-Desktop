// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import * as LocaleMatcher from '@formatjs/intl-localematcher';

import { strictAssert } from './assert.std.ts';

export const FAKE_DEFAULT_LOCALE = 'und'; // 'und' is the BCP 47 subtag for "undetermined"

strictAssert(
  new Intl.Locale(FAKE_DEFAULT_LOCALE).toString() === FAKE_DEFAULT_LOCALE,
  "Ensure Intl doesn't change our fake locale ever"
);

/**
 * Matches the user's preferred locales against the locales an engine supports,
 * in preference order. Falls back to `defaultLocale` when nothing matches.
 */
export function getLanguages(
  preferredSystemLocales: ReadonlyArray<string>,
  availableLocales: ReadonlyArray<string>,
  defaultLocale: string
): Array<string> {
  const matchedLocales = [];

  preferredSystemLocales.forEach(preferredSystemLocale => {
    const matchedLocale = LocaleMatcher.match(
      [preferredSystemLocale],
      availableLocales as Array<string>, // bad types
      // We don't want to fallback to the default locale right away in case we might
      // match some other locales first.
      //
      // However, we do want to match the default locale in case the user's locales
      // actually matches it.
      //
      // This fake locale allows us to reliably filter it out within the loop.
      FAKE_DEFAULT_LOCALE,
      { algorithm: 'best fit' }
    );
    if (matchedLocale !== FAKE_DEFAULT_LOCALE) {
      matchedLocales.push(matchedLocale);
    }
  });

  if (matchedLocales.length === 0) {
    matchedLocales.push(defaultLocale);
  }

  return matchedLocales;
}
