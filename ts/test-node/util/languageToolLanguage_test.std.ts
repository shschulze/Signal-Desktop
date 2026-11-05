// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import { resolveCheckLanguage } from '../../util/languageToolLanguage.std.ts';

describe('resolveCheckLanguage', () => {
  it('prefers an explicitly configured language', () => {
    assert.strictEqual(resolveCheckLanguage('de-DE', ['en-US']), 'de-DE');
  });

  it('trims the configured language', () => {
    assert.strictEqual(resolveCheckLanguage('  fr  ', ['en-US']), 'fr');
  });

  it('matches the preferred locale when nothing is configured', () => {
    assert.strictEqual(resolveCheckLanguage('', ['de-DE']), 'de-DE');
    assert.strictEqual(resolveCheckLanguage(undefined, ['en-GB']), 'en-GB');
  });

  it('falls back to English for unknown locales', () => {
    assert.strictEqual(resolveCheckLanguage('', ['xx-YY']), 'en-US');
    assert.strictEqual(resolveCheckLanguage('', []), 'en-US');
  });
});
