// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import Quill, { Delta } from '@signalapp/quill-cjs';

import { MentionBlot } from '../../quill/mentions/blot.dom.tsx';
import {
  collectTextLeaves,
  rangeForIndices,
} from '../../quill/grammar-check/mapping.dom.ts';
import { extractTextFromOps } from '../../quill/grammar-check/mapping.std.ts';
import { generateAci } from '../../test-helpers/serviceIdUtils.std.ts';

Quill.register({ 'formats/mention': MentionBlot }, true);

function mention(): Record<string, unknown> {
  return { insert: { mention: { aci: generateAci(), title: 'Alice' } } };
}

describe('grammar check DOM mapping', () => {
  let container: HTMLDivElement;
  let quill: Quill;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    quill = new Quill(container, { formats: ['mention'], modules: {} });
  });

  afterEach(() => {
    container.remove();
  });

  function setContents(ops: ConstructorParameters<typeof Delta>[0]): void {
    quill.setContents(new Delta(ops));
  }

  function getLeaves(): Array<{ index: number; text: string }> {
    return collectTextLeaves(quill).map(leaf => ({
      index: leaf.index,
      text: leaf.textNode.data,
    }));
  }

  describe('collectTextLeaves', () => {
    it('reports Quill indices for text broken up by a mention', () => {
      setContents([
        { insert: 'Hallo ' },
        mention(),
        { insert: ' das ist ein fehler\n' },
      ]);

      assert.deepEqual(getLeaves(), [
        { index: 0, text: 'Hallo ' },
        // The mention occupies index 6, so the text after it starts at 7.
        { index: 7, text: ' das ist ein fehler' },
      ]);
    });

    it('counts a mention at the start of the line', () => {
      setContents([mention(), { insert: ' das ist ein fehler\n' }]);

      assert.deepEqual(getLeaves(), [
        // The mention occupies index 0, so the text after it starts at 1.
        { index: 1, text: ' das ist ein fehler' },
      ]);
    });

    it('reports Quill indices across several lines', () => {
      setContents([{ insert: 'eins zwei\ndrei vier\n' }]);

      assert.deepEqual(getLeaves(), [
        { index: 0, text: 'eins zwei' },
        // Newline after the first line is part of the Quill index space.
        { index: 10, text: 'drei vier' },
      ]);
    });
  });

  describe('rangeForIndices', () => {
    it('maps a match after a mention to the flagged text', () => {
      setContents([
        { insert: 'Hallo ' },
        mention(),
        { insert: ' das ist ein fehler\n' },
      ]);

      const { text } = extractTextFromOps(quill.getContents().ops ?? []);
      const offset = text.indexOf('fehler');

      const range = rangeForIndices(collectTextLeaves(quill), offset, 6);

      assert.strictEqual(range?.toString(), 'fehler');
    });

    it('maps a match after a mention at the start of the line', () => {
      setContents([mention(), { insert: ' das ist ein fehler\n' }]);

      const { text } = extractTextFromOps(quill.getContents().ops ?? []);
      const offset = text.indexOf('fehler');

      const range = rangeForIndices(collectTextLeaves(quill), offset, 6);

      assert.strictEqual(range?.toString(), 'fehler');
    });

    it('maps a match on a later line to the flagged text', () => {
      setContents([{ insert: 'eins zwei\ndrei vier\n' }]);

      const { text } = extractTextFromOps(quill.getContents().ops ?? []);
      const offset = text.indexOf('vier');

      const range = rangeForIndices(collectTextLeaves(quill), offset, 4);

      assert.strictEqual(range?.toString(), 'vier');
    });
  });
});
