// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import Quill, { Delta } from '@signalapp/quill-cjs';
import * as sinon from 'sinon';

import { GrammarCheck } from '../../quill/grammar-check/index.dom.ts';
import type {
  GrammarCheckResponseType,
  GrammarMatchType,
} from '../../types/LanguageTool.std.ts';

const HIGHLIGHT_NAMES = {
  spelling: 'signal-grammar-spelling',
  grammar: 'signal-grammar-grammar',
  style: 'signal-grammar-style',
  recommendation: 'signal-grammar-recommendation',
} as const;

type HighlightName = (typeof HIGHLIGHT_NAMES)[keyof typeof HIGHLIGHT_NAMES];

const TEXT = 'Das ist ein Fehler\n';

function tick(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

function highlightedText(
  name: HighlightName = HIGHLIGHT_NAMES.spelling
): Array<string> {
  const highlight = CSS.highlights.get(name);
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
    for (const name of Object.values(HIGHLIGHT_NAMES)) {
      CSS.highlights.delete(name);
    }
  });

  async function createChecked(
    input: string,
    matchOverrides: ReadonlyArray<Partial<GrammarMatchType>> = [{}]
  ): Promise<sinon.SinonStub> {
    const offset = input.indexOf('Fehler');
    const response: GrammarCheckResponseType = {
      ok: true,
      matches: matchOverrides.map(overrides => ({
        message: 'Möglicher Tippfehler.',
        replacements: ['Fehler'],
        offset,
        length: 'Fehler'.length,
        ruleId: 'MORFOLOGIK_RULE_DE_DE',
        ruleDescription: 'Rechtschreibung',
        issueType: 'misspelling',
        ...overrides,
      })),
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

  it('highlights spelling matches', async () => {
    await createChecked(TEXT);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.spelling), ['Fehler']);
  });

  it('treats known spelling rule ids as spelling', async () => {
    await createChecked(TEXT, [
      {
        ruleId: 'HUNSPELL_RULE',
        issueType: 'grammar',
      },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.spelling), ['Fehler']);
    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.grammar), []);
  });

  it('uses the grammar color for grammar issue types', async () => {
    await createChecked(TEXT, [
      {
        ruleId: 'DE_AGREEMENT',
        issueType: 'grammar',
      },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.grammar), ['Fehler']);
    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.spelling), []);
  });

  it('uses the style color for style issue types', async () => {
    await createChecked(TEXT, [
      {
        ruleId: 'STYLE_RULE',
        issueType: 'style',
      },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.style), ['Fehler']);
  });

  it('uses the recommendation color for recommendation issue types', async () => {
    await createChecked(TEXT, [
      {
        ruleId: 'RECOMMENDATION_RULE',
        issueType: 'RECOMMENDATION',
      },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.recommendation), [
      'Fehler',
    ]);
  });

  it('treats spoken-language register issues as style', async () => {
    await createChecked(TEXT, [
      {
        ruleId: 'REGISTER_RULE',
        issueType: 'register',
      },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.style), ['Fehler']);
  });

  it('prioritizes errors over suggestions when matches overlap', async () => {
    await createChecked(TEXT, [
      { ruleId: 'STYLE_RULE', issueType: 'style' },
      { ruleId: 'MORFOLOGIK_RULE_DE_DE', issueType: 'misspelling' },
    ]);

    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.spelling), ['Fehler']);
    assert.deepEqual(highlightedText(HIGHLIGHT_NAMES.style), ['Fehler']);
    assert.isAbove(
      CSS.highlights.get(HIGHLIGHT_NAMES.spelling)?.priority ?? 0,
      CSS.highlights.get(HIGHLIGHT_NAMES.style)?.priority ?? 0
    );
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
