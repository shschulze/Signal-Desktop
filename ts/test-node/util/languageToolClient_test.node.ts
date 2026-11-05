// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { LanguageToolClient } from '../../util/languageToolClient.node.ts';
import { AUTO_DETECT_LANGUAGE } from '../../types/LanguageTool.std.ts';
import type { LoggerType } from '../../types/Logging.std.ts';

type HandlerType = (
  request: IncomingMessage,
  response: ServerResponse,
  body: string
) => void;

function createLogger(): LoggerType {
  const noop = () => undefined;
  const logger: LoggerType = {
    fatal: noop,
    error: noop,
    warn: noop,
    info: noop,
    debug: noop,
    trace: noop,
    child: () => logger,
  };
  return logger;
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Array<Buffer<ArrayBuffer>> = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

describe('LanguageToolClient', () => {
  let server: Server;
  let baseUrl: string;
  let handler: HandlerType;
  let requestCount = 0;
  let lastBody = '';
  let lastUrl = '';

  beforeEach(async () => {
    requestCount = 0;
    lastBody = '';
    lastUrl = '';

    server = createServer(async (request, response) => {
      requestCount += 1;
      lastUrl = request.url ?? '';

      const body = await readBody(request);
      lastBody = body;
      handler(request, response, body);
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', resolve);
    });

    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>(resolve => {
      server.close(() => resolve());
    });
  });

  function createClient(
    options: Readonly<{
      url?: string;
      disabledRules?: ReadonlyArray<string>;
      ignoredWords?: ReadonlyArray<string>;
      includeStyleRules?: boolean;
    }> = {}
  ): LanguageToolClient {
    return new LanguageToolClient({
      getServerUrl: () => options.url ?? baseUrl,
      getIncludeStyleRules: () => options.includeStyleRules ?? false,
      getDisabledRules: () => options.disabledRules ?? [],
      getIgnoredWords: () => options.ignoredWords ?? [],
      logger: createLogger(),
    });
  }

  function respondJson(response: ServerResponse, value: unknown): void {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  }

  describe('check', () => {
    it('reports unconfigured when no server URL is set', async () => {
      const client = createClient({ url: '' });

      assert.deepEqual(
        await client.check({ text: 'helo', language: 'en-US' }),
        {
          ok: false,
          error: 'unconfigured',
        }
      );
      assert.strictEqual(requestCount, 0);
    });

    it('does not hit the network for empty text', async () => {
      const client = createClient();

      assert.deepEqual(await client.check({ text: '', language: 'en-US' }), {
        ok: true,
        matches: [],
      });
      assert.strictEqual(requestCount, 0);
    });

    it('rejects text beyond the limit', async () => {
      const client = createClient();

      const result = await client.check({
        text: 'a'.repeat(5000),
        language: 'en-US',
      });

      assert.deepEqual(result, { ok: false, error: 'textTooLong' });
      assert.strictEqual(requestCount, 0);
    });

    it('sends auto-detection through to the server', async () => {
      handler = (_request, response) => {
        respondJson(response, { matches: [] });
      };

      await createClient().check({
        text: 'Das ist ein Satz.',
        language: AUTO_DETECT_LANGUAGE,
      });

      assert.include(lastBody, 'language=auto');
    });

    it('returns the detected language', async () => {
      handler = (_request, response) => {
        respondJson(response, {
          matches: [],
          language: {
            name: 'German (Germany)',
            code: 'de-DE',
            detectedLanguage: {
              name: 'German (Germany)',
              code: 'de-DE',
              confidence: 0.98,
              source: 'ngram',
            },
          },
        });
      };

      const result = await createClient().check({
        text: 'Das ist ein Satz.',
        language: AUTO_DETECT_LANGUAGE,
      });

      assert.isTrue(result.ok);
      if (result.ok) {
        assert.deepEqual(result.detectedLanguage, {
          name: 'German (Germany)',
          code: 'de-DE',
        });
      }
    });

    it('omits the detected language when the server does not report one', async () => {
      handler = (_request, response) => {
        respondJson(response, { matches: [] });
      };

      const result = await createClient().check({
        text: 'hello',
        language: 'en-US',
      });

      assert.isTrue(result.ok);
      if (result.ok) {
        assert.isUndefined(result.detectedLanguage);
      }
    });

    it('keys ignored words by the detected language', async () => {
      handler = (_request, response) => {
        respondJson(response, {
          matches: [
            {
              message: 'Possible spelling mistake',
              replacements: [],
              offset: 0,
              length: 10,
              rule: {
                id: 'SPELL',
                description: 'Spelling',
                issueType: 'misspelling',
              },
            },
          ],
          language: {
            name: 'German (Germany)',
            code: 'de-DE',
            detectedLanguage: {
              name: 'German (Germany)',
              code: 'de-DE',
            },
          },
        });
      };

      const client = new LanguageToolClient({
        getServerUrl: () => baseUrl,
        getIncludeStyleRules: () => false,
        getDisabledRules: () => [],
        getIgnoredWords: language =>
          language === 'de-DE' ? ['Signalnetz'] : [],
        logger: createLogger(),
      });

      const result = await client.check({
        text: 'Signalnetz',
        language: AUTO_DETECT_LANGUAGE,
      });

      assert.isTrue(result.ok);
      if (result.ok) {
        assert.strictEqual(result.matches.length, 0);
      }
    });

    it('normalizes matches', async () => {
      handler = (_request, response) => {
        respondJson(response, {
          matches: [
            {
              message: 'This sentence does not start with an uppercase letter.',
              shortMessage: 'Uppercase',
              replacements: [{ value: 'Hello' }],
              offset: 0,
              length: 5,
              rule: {
                id: 'UPPERCASE_SENTENCE_START',
                description: 'Uppercase sentence start',
                issueType: 'typographical',
              },
            },
          ],
        });
      };

      const client = createClient();
      const result = await client.check({
        text: 'hello there',
        language: 'en-US',
      });

      assert.isTrue(result.ok);
      if (result.ok) {
        assert.strictEqual(result.matches.length, 1);
        assert.deepEqual(result.matches[0], {
          message: 'This sentence does not start with an uppercase letter.',
          shortMessage: 'Uppercase',
          replacements: ['Hello'],
          offset: 0,
          length: 5,
          ruleId: 'UPPERCASE_SENTENCE_START',
          ruleDescription: 'Uppercase sentence start',
          issueType: 'typographical',
        });
      }

      assert.strictEqual(lastUrl, '/v2/check');
      assert.include(lastBody, 'language=en-US');
    });

    it('drops style rules unless they are enabled', async () => {
      handler = (_request, response) => {
        respondJson(response, {
          matches: [
            {
              message: 'Style issue',
              replacements: [{ value: 'x' }],
              offset: 0,
              length: 2,
              rule: { id: 'STYLE_1', description: 'Style', issueType: 'style' },
            },
            {
              message: 'Spelling issue',
              replacements: [{ value: 'y' }],
              offset: 3,
              length: 2,
              rule: {
                id: 'MORFOLOGIK_RULE_EN_US',
                description: 'Spelling',
                issueType: 'misspelling',
              },
            },
          ],
        });
      };

      const withoutStyle = await createClient().check({
        text: 'aa bb',
        language: 'en-US',
      });
      assert.isTrue(withoutStyle.ok);
      if (withoutStyle.ok) {
        assert.strictEqual(withoutStyle.matches.length, 1);
        assert.strictEqual(
          withoutStyle.matches[0]?.ruleId,
          'MORFOLOGIK_RULE_EN_US'
        );
      }

      const withStyle = await createClient({ includeStyleRules: true }).check({
        text: 'aa bb',
        language: 'en-US',
      });
      assert.isTrue(withStyle.ok);
      if (withStyle.ok) {
        assert.strictEqual(withStyle.matches.length, 2);
      }
    });

    it('drops ignored words', async () => {
      handler = (_request, response) => {
        respondJson(response, {
          matches: [
            {
              message: 'Possible spelling mistake',
              replacements: [],
              offset: 0,
              length: 6,
              rule: {
                id: 'SPELL',
                description: 'Spelling',
                issueType: 'misspelling',
              },
            },
          ],
        });
      };

      const client = createClient({ ignoredWords: ['Signal'] });
      const result = await client.check({ text: 'Signal', language: 'en-US' });

      assert.isTrue(result.ok);
      if (result.ok) {
        assert.strictEqual(result.matches.length, 0);
      }
    });

    it('sends disabled rules to the server', async () => {
      handler = (_request, response) => {
        respondJson(response, { matches: [] });
      };

      const client = createClient({
        disabledRules: ['EN_QUOTES', 'UPPERCASE'],
      });
      await client.check({ text: 'hello', language: 'en-US' });

      assert.include(lastBody, 'disabledRules=EN_QUOTES%2CUPPERCASE');
    });

    it('maps 429 to rateLimited', async () => {
      handler = (_request, response) => {
        response.writeHead(429);
        response.end();
      };

      const result = await createClient().check({
        text: 'hello',
        language: 'en-US',
      });

      assert.deepEqual(result, { ok: false, error: 'rateLimited' });
    });

    it('maps 5xx to serverError', async () => {
      handler = (_request, response) => {
        response.writeHead(503);
        response.end();
      };

      const result = await createClient().check({
        text: 'hello',
        language: 'en-US',
      });

      assert.deepEqual(result, { ok: false, error: 'serverError' });
    });

    it('maps unexpected responses to badResponse', async () => {
      handler = (_request, response) => {
        respondJson(response, { unexpected: true });
      };

      const result = await createClient().check({
        text: 'hello',
        language: 'en-US',
      });

      assert.deepEqual(result, { ok: false, error: 'badResponse' });
    });

    it('maps connection failures to unreachable', async () => {
      const client = createClient({ url: 'http://127.0.0.1:1' });

      const result = await client.check({ text: 'hello', language: 'en-US' });

      assert.deepEqual(result, { ok: false, error: 'unreachable' });
    });

    it('caches identical requests', async () => {
      handler = (_request, response) => {
        respondJson(response, { matches: [] });
      };

      const client = createClient();
      await client.check({ text: 'hello', language: 'en-US' });
      await client.check({ text: 'hello', language: 'en-US' });

      assert.strictEqual(requestCount, 1);
    });

    it('does not share the cache across servers', async () => {
      handler = (_request, response) => {
        respondJson(response, { matches: [] });
      };

      const first = createClient();
      await first.check({ text: 'hello', language: 'en-US' });

      let otherRequestCount = 0;
      const otherServer = createServer((_request, response) => {
        otherRequestCount += 1;
        respondJson(response, { matches: [] });
      });
      await new Promise<void>(resolve => {
        otherServer.listen(0, '127.0.0.1', resolve);
      });
      const otherAddress = otherServer.address() as AddressInfo;

      try {
        const second = createClient({
          url: `http://127.0.0.1:${otherAddress.port}`,
        });
        await second.check({ text: 'hello', language: 'en-US' });
      } finally {
        await new Promise<void>(resolve => {
          otherServer.close(() => resolve());
        });
      }

      assert.strictEqual(requestCount, 1);
      assert.strictEqual(otherRequestCount, 1);
    });
  });

  describe('getLanguages', () => {
    it('parses the language list', async () => {
      handler = (_request, response) => {
        respondJson(response, [
          { name: 'English (US)', code: 'en-US', longCode: 'en-US' },
          { name: 'German', code: 'de', longCode: 'de-DE' },
        ]);
      };

      const languages = await createClient().getLanguages();

      assert.strictEqual(lastUrl, '/v2/languages');
      assert.deepEqual(languages, [
        { name: 'English (US)', code: 'en-US', longCode: 'en-US' },
        { name: 'German', code: 'de', longCode: 'de-DE' },
      ]);
    });

    it('caches the language list', async () => {
      handler = (_request, response) => {
        respondJson(response, [
          { name: 'English', code: 'en', longCode: 'en-US' },
        ]);
      };

      const client = createClient();
      await client.getLanguages();
      await client.getLanguages();

      assert.strictEqual(requestCount, 1);
    });

    it('returns an empty list when the server fails', async () => {
      handler = (_request, response) => {
        response.writeHead(500);
        response.end();
      };

      assert.deepEqual(await createClient().getLanguages(), []);
    });

    it('returns an empty list when unconfigured', async () => {
      assert.deepEqual(await createClient({ url: '' }).getLanguages(), []);
      assert.strictEqual(requestCount, 0);
    });
  });

  describe('testConnection', () => {
    it('succeeds against a healthy server', async () => {
      handler = (_request, response) => {
        respondJson(response, []);
      };

      assert.deepEqual(await createClient().testConnection(baseUrl), {
        ok: true,
      });
    });

    it('reports insecure endpoints', async () => {
      assert.deepEqual(
        await createClient().testConnection('http://example.com'),
        { ok: false, error: 'insecureEndpoint' }
      );
      assert.strictEqual(requestCount, 0);
    });

    it('reports unreachable servers', async () => {
      assert.deepEqual(
        await createClient().testConnection('http://127.0.0.1:1'),
        { ok: false, error: 'unreachable' }
      );
    });
  });
});
