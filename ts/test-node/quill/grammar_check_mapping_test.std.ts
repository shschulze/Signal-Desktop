// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';

import {
  EMBED_PLACEHOLDER,
  extractTextFromOps,
  isUsableMatch,
  overlapsEmbed,
} from '../../quill/grammar-check/mapping.std.ts';

describe('grammar check mapping', () => {
  describe('extractTextFromOps', () => {
    it('concatenates text ops', () => {
      const { text, embedOffsets } = extractTextFromOps([
        { insert: 'Hello ' },
        { insert: 'world\n' },
      ]);

      assert.strictEqual(text, 'Hello world\n');
      assert.deepEqual(embedOffsets, []);
    });

    it('keeps newlines so offsets match Quill indices', () => {
      const { text } = extractTextFromOps([
        { insert: 'First line\n' },
        { insert: 'Second line\n' },
      ]);

      assert.strictEqual(text, 'First line\nSecond line\n');
      assert.strictEqual(text.indexOf('Second'), 11);
    });

    it('replaces embeds with a single placeholder', () => {
      const { text, embedOffsets } = extractTextFromOps([
        { insert: 'Hi ' },
        { insert: { mention: { aci: 'abc', title: 'Alice' } } },
        { insert: ' there\n' },
      ]);

      assert.strictEqual(text, `Hi ${EMBED_PLACEHOLDER} there\n`);
      assert.strictEqual(embedOffsets.length, 1);
      assert.strictEqual(embedOffsets[0], 3);
    });

    it('tracks several embeds', () => {
      const { text, embedOffsets } = extractTextFromOps([
        { insert: { emoji: { value: 'cat' } } },
        { insert: 'and' },
        { insert: { emoji: { value: 'dog' } } },
        { insert: '\n' },
      ]);

      assert.strictEqual(text.length, 6);
      assert.deepEqual(embedOffsets, [0, 4]);
    });

    it('ignores ops that are not inserts', () => {
      const { text } = extractTextFromOps([
        { insert: 'ab' },
        { retain: 4 },
        {},
      ]);

      assert.strictEqual(text, 'ab');
    });
  });

  describe('overlapsEmbed', () => {
    const embedOffsets = [3, 10];

    it('detects a match covering an embed', () => {
      assert.isTrue(overlapsEmbed(2, 3, embedOffsets));
      assert.isTrue(overlapsEmbed(3, 1, embedOffsets));
      assert.isTrue(overlapsEmbed(8, 5, embedOffsets));
    });

    it('allows matches that stop at an embed boundary', () => {
      assert.isFalse(overlapsEmbed(0, 3, embedOffsets));
      assert.isFalse(overlapsEmbed(4, 2, embedOffsets));
      assert.isFalse(overlapsEmbed(11, 2, embedOffsets));
    });

    it('allows everything when there are no embeds', () => {
      assert.isFalse(overlapsEmbed(0, 100, []));
    });
  });

  describe('isUsableMatch', () => {
    it('rejects zero-length matches', () => {
      assert.isFalse(isUsableMatch(3, 0, 10));
    });

    it('rejects matches that run past the text', () => {
      assert.isFalse(isUsableMatch(8, 5, 10));
    });

    it('rejects negative offsets', () => {
      assert.isFalse(isUsableMatch(-1, 2, 10));
    });

    it('accepts matches inside the text', () => {
      assert.isTrue(isUsableMatch(0, 10, 10));
      assert.isTrue(isUsableMatch(2, 3, 10));
    });
  });
});
