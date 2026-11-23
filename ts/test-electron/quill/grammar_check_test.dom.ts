// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { assert } from 'chai';
import Quill, { Delta } from '@signalapp/quill-cjs';
import * as sinon from 'sinon';

import { GrammarCheck } from '../../quill/grammar-check/index.dom.ts';
import { collectTextLeaves } from '../../quill/grammar-check/mapping.dom.ts';
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
const CARD_SELECTOR = '.module-grammar-check-card';

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
  let caretPosition: sinon.SinonStub | undefined;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    caretPosition = undefined;
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

  function stubCaretAt(textOffset: number): void {
    const leaves = collectTextLeaves(quill);
    const leaf = leaves.find(
      candidate =>
        textOffset >= candidate.index &&
        textOffset < candidate.index + candidate.length
    );
    if (leaf === undefined) {
      assert.fail(`No text leaf at offset ${textOffset}`);
    }

    caretPosition ??= sandbox.stub(document, 'caretPositionFromPoint');
    caretPosition.returns({
      offsetNode: leaf.textNode,
      offset: textOffset - leaf.index,
      getClientRect: () => new DOMRect(),
    });
  }

  function click(button = 0): void {
    document.body.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button })
    );
  }

  function findCard(): HTMLElement | null {
    return document.querySelector<HTMLElement>(CARD_SELECTOR);
  }

  it('opens the card when an issue is clicked', async () => {
    await createChecked(TEXT);
    stubCaretAt(TEXT.indexOf('Fehler'));

    click();

    assert.isNotNull(findCard());
  });

  it('does not open the card when the pointer merely moves', async () => {
    await createChecked(TEXT);
    stubCaretAt(TEXT.indexOf('Fehler'));

    quill.root.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await new Promise(resolve => {
      setTimeout(resolve, 400);
    });

    assert.isNull(findCard());
  });

  it('closes the card when clicking somewhere else', async () => {
    await createChecked(TEXT);
    stubCaretAt(TEXT.indexOf('Fehler'));

    click();
    assert.isNotNull(findCard());

    stubCaretAt(0);
    click();

    assert.isNull(findCard());
  });

  it('keeps the card open when clicking inside it', async () => {
    await createChecked(TEXT);
    stubCaretAt(TEXT.indexOf('Fehler'));

    click();
    const card = findCard();
    assert.isNotNull(card);

    card?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    assert.strictEqual(findCard(), card);
  });

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
