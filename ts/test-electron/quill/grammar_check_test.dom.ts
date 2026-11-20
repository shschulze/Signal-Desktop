// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import Quill, { Delta } from '@signalapp/quill-cjs';
import * as sinon from 'sinon';

import { GrammarCheck } from '../../quill/grammar-check/index.dom.ts';
import type { GrammarCheckResponseType } from '../../types/LanguageTool.std.ts';

const HIGHLIGHT_NAME = 'signal-grammar';
const TEXT = 'Das ist ein Fehler\n';

function tick(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

function highlightedText(): Array<string> {
  const highlight = CSS.highlights.get(HIGHLIGHT_NAME);
  if (highlight === undefined) {
    return [];
  }
  return [...highlight].map(range => (range as Range).toString());
}

describe('GrammarCheck', () => {
  let container: HTMLDivElement;
  let quill: Quill;
  let grammarCheck: GrammarCheck | undefined;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    container = document.createElement('div');
    document.body.append(container);
    quill = new Quill(container, { modules: {} });
  });

  afterEach(() => {
    grammarCheck?.destroy();
    grammarCheck = undefined;
    container.remove();
    sandbox.restore();
    CSS.highlights.delete(HIGHLIGHT_NAME);
  });

  async function createChecked(input: string): Promise<sinon.SinonStub> {
    const offset = input.indexOf('Fehler');
    const response: GrammarCheckResponseType = {
      ok: true,
      matches: [
        {
          message: 'Möglicher Tippfehler.',
          replacements: ['Fehler'],
          offset,
          length: 'Fehler'.length,
          ruleId: 'MORFOLOGIK_RULE_DE_DE',
          ruleDescription: 'Rechtschreibung',
          issueType: 'misspelling',
        },
      ],
    };

    const checkGrammar = sandbox.stub().resolves(response);
    sandbox.stub(window, 'Events').value({
      checkGrammar,
      getSpellCheck: sandbox.stub().resolves(true),
      getLanguageToolLanguage: sandbox.stub().resolves(''),
      subscribeToGrammarCommands: sandbox.stub().returns(() => undefined),
    });

    quill.setContents(new Delta([{ insert: input }]));

    grammarCheck = new GrammarCheck(quill, {
      i18n: window.SignalContext.i18n,
    });

    // Let the initial config load and check finish.
    await tick();

    return checkGrammar;
  }

  it('highlights matches', async () => {
    await createChecked(TEXT);

    assert.deepEqual(highlightedText(), ['Fehler']);
  });

  it('keeps highlights when formatting changes the DOM but not the text', async () => {
    const checkGrammar = await createChecked(TEXT);
    const offset = TEXT.indexOf('Fehler');

    quill.formatText(offset, 'Fehler'.length, 'bold', true);

    assert.deepEqual(highlightedText(), ['Fehler']);
    // The text is unchanged, so there is nothing new to check.
    assert.strictEqual(checkGrammar.callCount, 1);
  });

  it('keeps highlights when only part of a match is formatted', async () => {
    await createChecked(TEXT);
    const offset = TEXT.indexOf('Fehler');

    quill.formatText(offset + 1, 3, 'bold', true);

    assert.deepEqual(highlightedText(), ['Fehler']);
  });
});
