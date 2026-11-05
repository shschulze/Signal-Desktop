// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  buildApiUrl,
  resolveEndpoint,
} from '../../util/languageToolEndpoint.std.ts';

describe('resolveEndpoint', () => {
  it('treats an empty value as unconfigured', () => {
    assert.deepEqual(resolveEndpoint(undefined), {
      ok: false,
      error: 'unconfigured',
    });
    assert.deepEqual(resolveEndpoint('   '), {
      ok: false,
      error: 'unconfigured',
    });
  });

  it('rejects values that are not URLs', () => {
    assert.deepEqual(resolveEndpoint('not a url'), {
      ok: false,
      error: 'invalidEndpoint',
    });
  });

  it('rejects protocols other than http and https', () => {
    assert.deepEqual(resolveEndpoint('ftp://example.com'), {
      ok: false,
      error: 'invalidEndpoint',
    });
    assert.deepEqual(resolveEndpoint('file:///etc/passwd'), {
      ok: false,
      error: 'invalidEndpoint',
    });
  });

  it('rejects http for non-loopback hosts', () => {
    assert.deepEqual(resolveEndpoint('http://example.com'), {
      ok: false,
      error: 'insecureEndpoint',
    });
  });

  it('allows http for loopback hosts', () => {
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const result = resolveEndpoint(`http://${host}:8081`);
      assert.isTrue(result.ok, host);
      if (result.ok) {
        assert.isTrue(result.endpoint.isLoopback);
        assert.strictEqual(result.endpoint.baseUrl, `http://${host}:8081`);
      }
    }
  });

  it('allows https for remote hosts', () => {
    const result = resolveEndpoint('https://languagetool.example.com/');
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.isFalse(result.endpoint.isLoopback);
      assert.strictEqual(
        result.endpoint.baseUrl,
        'https://languagetool.example.com'
      );
    }
  });

  it('normalizes trailing slashes and keeps a subpath', () => {
    const result = resolveEndpoint('https://example.com/languagetool//');
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.strictEqual(
        result.endpoint.baseUrl,
        'https://example.com/languagetool'
      );
    }
  });

  it('rejects credentials', () => {
    assert.deepEqual(resolveEndpoint('https://user:pass@example.com'), {
      ok: false,
      error: 'invalidEndpoint',
    });
  });

  it('rejects query strings and fragments', () => {
    assert.deepEqual(resolveEndpoint('https://example.com/?a=1'), {
      ok: false,
      error: 'invalidEndpoint',
    });
    assert.deepEqual(resolveEndpoint('https://example.com/#x'), {
      ok: false,
      error: 'invalidEndpoint',
    });
  });
});

describe('buildApiUrl', () => {
  it('appends the API path to the base URL', () => {
    const result = resolveEndpoint('http://127.0.0.1:8081');
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.strictEqual(
        buildApiUrl(result.endpoint, '/v2/check'),
        'http://127.0.0.1:8081/v2/check'
      );
    }
  });

  it('appends after a subpath', () => {
    const result = resolveEndpoint('https://example.com/lt/');
    assert.isTrue(result.ok);
    if (result.ok) {
      assert.strictEqual(
        buildApiUrl(result.endpoint, '/v2/languages'),
        'https://example.com/lt/v2/languages'
      );
    }
  });
});
