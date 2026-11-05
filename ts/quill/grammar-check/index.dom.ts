// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type Quill from '@signalapp/quill-cjs';
import { Delta } from '@signalapp/quill-cjs';
import Emitter from '@signalapp/quill-cjs/core/emitter.js';

import type { LocalizerType } from '../../types/Util.std.ts';
import type {
  DetectedLanguageType,
  GrammarCommandType,
  GrammarMatchType,
} from '../../types/LanguageTool.std.ts';
import { AUTO_DETECT_LANGUAGE } from '../../types/LanguageTool.std.ts';
import { createLogger } from '../../logging/log.std.ts';
import { resolveCheckLanguage } from '../../util/languageToolLanguage.std.ts';
import {
  extractTextFromOps,
  isUsableMatch,
  overlapsEmbed,
} from './mapping.std.ts';
import { collectTextLeaves, rangeForIndices } from './mapping.dom.ts';

const log = createLogger('grammarCheck');

const HIGHLIGHT_NAME = 'signal-grammar';
const CHECK_DELAY_MS = 800;
const HOVER_DELAY_MS = 350;
const MIN_TEXT_LENGTH = 3;
const MAX_MENU_REPLACEMENTS = 5;
const MAX_CARD_REPLACEMENTS = 3;
const CARD_GAP = 6;
const VIEWPORT_MARGIN = 8;

export type GrammarCheckOptionsType = Readonly<{
  i18n: LocalizerType;
}>;

type ActiveMatchType = Readonly<{
  match: GrammarMatchType;
  range: Range;
}>;

function supportsHighlights(): boolean {
  return (
    typeof CSS !== 'undefined' &&
    CSS.highlights != null &&
    typeof Highlight !== 'undefined'
  );
}

/**
 * Marks spelling and grammar issues found by LanguageTool.
 *
 * Underlines are drawn with the CSS Custom Highlight API so that the Quill
 * Delta is never touched; only applying a suggestion modifies the document.
 */
export class GrammarCheck {
  readonly #quill: Quill;
  readonly #options: GrammarCheckOptionsType;

  #checkTimer: ReturnType<typeof setTimeout> | undefined;
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;
  #requestId = 0;
  #disposed = false;

  #matches: Array<ActiveMatchType> = [];
  #lastCheckedText: string | undefined;
  readonly #unsubscribeCommands: () => void;

  #isEnabled = false;
  /** What we send as `language=`: an explicit code, or `auto`. */
  #requestLanguage = '';
  /** Best guess before/without detection, used to key ignored words. */
  #guessLanguage = '';
  #detectedLanguage: DetectedLanguageType | undefined;
  #languages: Array<{ label: string; value: string }> | undefined;
  #cardMatch: ActiveMatchType | undefined;

  #card: HTMLDivElement | undefined;

  constructor(quill: Quill, options: GrammarCheckOptionsType) {
    this.#quill = quill;
    this.#options = options;

    if (!supportsHighlights()) {
      log.warn('CSS Custom Highlight API unavailable; grammar check disabled');
      this.#unsubscribeCommands = () => undefined;
      return;
    }

    quill.on(Emitter.events.TEXT_CHANGE, this.#onTextChange);
    quill.root.addEventListener('focus', this.#onFocus);
    quill.root.addEventListener('mousedown', this.#onMouseDown);
    quill.root.addEventListener('mousemove', this.#onMouseMove);

    window.addEventListener('scroll', this.#hideCard, true);
    document.addEventListener('keydown', this.#onKeyDown, true);

    this.#unsubscribeCommands = window.Events.subscribeToGrammarCommands(
      this.#onCommand
    );

    void this.#refreshConfig();
  }

  public destroy(): void {
    this.#disposed = true;
    this.#unsubscribeCommands();
    this.#clearTimers();
    this.#quill.off(Emitter.events.TEXT_CHANGE, this.#onTextChange);
    this.#quill.root.removeEventListener('focus', this.#onFocus);
    this.#quill.root.removeEventListener('mousedown', this.#onMouseDown);
    this.#quill.root.removeEventListener('mousemove', this.#onMouseMove);
    window.removeEventListener('scroll', this.#hideCard, true);
    document.removeEventListener('keydown', this.#onKeyDown, true);
    this.#clearMatches();
    this.#hideCard();
  }

  /** Runs a check immediately, discarding any cached text comparison. */
  public checkNow(): void {
    this.#lastCheckedText = undefined;
    this.#clearTimers();
    this.#clearMatches();
    void this.#runCheck();
  }

  #clearTimers(): void {
    if (this.#checkTimer !== undefined) {
      clearTimeout(this.#checkTimer);
      this.#checkTimer = undefined;
    }
    if (this.#hoverTimer !== undefined) {
      clearTimeout(this.#hoverTimer);
      this.#hoverTimer = undefined;
    }
  }

  readonly #onTextChange = (): void => {
    this.#requestId += 1;
    this.#clearMatches();
    this.#hideCard();
    this.#scheduleCheck();
  };

  readonly #onFocus = (): void => {
    // Settings may have changed while another view was open.
    void this.#refreshConfig();
  };

  async #refreshConfig(): Promise<void> {
    const [isEnabled, configuredLanguage] = await Promise.all([
      window.Events.getSpellCheck(),
      window.Events.getLanguageToolLanguage(),
    ]);

    if (this.#disposed) {
      return;
    }

    const configured = configuredLanguage.trim();
    const requestLanguage =
      configured.length > 0 ? configured : AUTO_DETECT_LANGUAGE;

    const changed =
      isEnabled !== this.#isEnabled ||
      requestLanguage !== this.#requestLanguage;

    this.#isEnabled = isEnabled;
    this.#requestLanguage = requestLanguage;
    this.#guessLanguage = resolveCheckLanguage(
      configured,
      window.SignalContext.getPreferredSystemLocales()
    );

    if (changed) {
      this.checkNow();
    }
  }

  #scheduleCheck(): void {
    if (this.#checkTimer !== undefined) {
      clearTimeout(this.#checkTimer);
    }

    this.#checkTimer = setTimeout(() => {
      this.#checkTimer = undefined;
      void this.#runCheck();
    }, CHECK_DELAY_MS);
  }

  async #runCheck(): Promise<void> {
    if (this.#disposed || !this.#isEnabled) {
      return;
    }
    if (!this.#quill.isEnabled()) {
      return;
    }

    const { text, embedOffsets } = extractTextFromOps(
      this.#quill.getContents().ops ?? []
    );
    if (text.trim().length < MIN_TEXT_LENGTH) {
      this.#clearMatches();
      return;
    }
    if (text === this.#lastCheckedText) {
      return;
    }

    const requestId = this.#requestId;
    const response = await window.Events.checkGrammar({
      text,
      language: this.#requestLanguage,
    });

    if (this.#disposed || requestId !== this.#requestId) {
      return;
    }
    if (!response.ok) {
      this.#clearMatches();
      return;
    }

    this.#lastCheckedText = text;
    this.#detectedLanguage = response.detectedLanguage;
    this.#applyMatches(response.matches, text, embedOffsets);
  }

  #applyMatches(
    matches: ReadonlyArray<GrammarMatchType>,
    text: string,
    embedOffsets: ReadonlyArray<number>
  ): void {
    const leaves = collectTextLeaves(this.#quill);
    const active: Array<ActiveMatchType> = [];

    for (const match of matches) {
      if (!isUsableMatch(match.offset, match.length, text.length)) {
        continue;
      }
      if (overlapsEmbed(match.offset, match.length, embedOffsets)) {
        continue;
      }

      const range = rangeForIndices(leaves, match.offset, match.length);
      if (range === undefined) {
        continue;
      }

      active.push({ match, range });
    }

    this.#matches = active;
    this.#paintHighlights();
  }

  #paintHighlights(): void {
    if (!supportsHighlights()) {
      return;
    }

    if (this.#matches.length === 0) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
      return;
    }

    CSS.highlights.set(
      HIGHLIGHT_NAME,
      new Highlight(...this.#matches.map(({ range }) => range))
    );
  }

  #clearMatches(): void {
    this.#matches = [];
    if (supportsHighlights()) {
      CSS.highlights.delete(HIGHLIGHT_NAME);
    }
  }

  #indexAtPoint(x: number, y: number): number | undefined {
    const position = document.caretPositionFromPoint(x, y);
    if (position == null || position.offsetNode.nodeType !== Node.TEXT_NODE) {
      return undefined;
    }

    const node = position.offsetNode;
    const leaf = collectTextLeaves(this.#quill).find(
      candidate => candidate.textNode === node
    );
    if (leaf === undefined) {
      return undefined;
    }

    return leaf.index + position.offset;
  }

  /**
   * The language actually in use: what the server detected, else our guess.
   * Used to key ignored words, since those are stored per language.
   */
  #effectiveLanguage(): string {
    return this.#detectedLanguage?.code ?? this.#guessLanguage;
  }

  #matchAt(index: number | undefined): ActiveMatchType | undefined {
    if (index === undefined) {
      return undefined;
    }

    return this.#matches.find(
      ({ match }) =>
        index >= match.offset && index < match.offset + match.length
    );
  }

  #wordFor(match: GrammarMatchType): string {
    return this.#quill.getText(match.offset, match.length);
  }

  readonly #onMouseDown = (event: MouseEvent): void => {
    // Only right clicks need a hint; it lets the native menu offer
    // replacements, which Electron cannot produce for us.
    if (event.button !== 2 || !this.#isEnabled) {
      return;
    }

    const match = this.#matchAt(
      this.#indexAtPoint(event.clientX, event.clientY)
    );
    if (match === undefined) {
      return;
    }

    window.Events.sendGrammarContextHint({
      message: match.match.message,
      replacements: match.match.replacements.slice(0, MAX_MENU_REPLACEMENTS),
      ruleId: match.match.ruleId,
      ruleDescription: match.match.ruleDescription,
      word: this.#wordFor(match.match),
      language: this.#effectiveLanguage(),
      offset: match.match.offset,
      length: match.match.length,
    });
  };

  readonly #onMouseMove = (event: MouseEvent): void => {
    if (this.#hoverTimer !== undefined || this.#card !== undefined) {
      return;
    }

    const { clientX, clientY } = event;

    this.#hoverTimer = setTimeout(() => {
      this.#hoverTimer = undefined;

      if (this.#disposed) {
        return;
      }

      const match = this.#matchAt(this.#indexAtPoint(clientX, clientY));
      if (match !== undefined) {
        this.#showCard(match);
      }
    }, HOVER_DELAY_MS);
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      this.#hideCard();
    }
  };

  readonly #onCommand = (command: GrammarCommandType): void => {
    if (this.#disposed) {
      return;
    }

    if (command.type === 'recheck') {
      this.checkNow();
      return;
    }

    const { offset, length, value } = command.replacement;
    this.#hideCard();
    this.#replace(offset, length, value);
  };

  #replace(offset: number, length: number, value: string): void {
    this.#quill.updateContents(
      new Delta().retain(offset).delete(length).insert(value),
      Emitter.sources.USER
    );
  }

  #showCard(activeMatch: ActiveMatchType): void {
    const { i18n } = this.#options;
    const { message, replacements, ruleId, ruleDescription } =
      activeMatch.match;

    this.#cardMatch = activeMatch;

    const card = this.#ensureCard();
    card.replaceChildren();

    const languageRow = this.#buildLanguageRow();
    if (languageRow !== undefined) {
      card.append(languageRow);
    }

    const messageElement = document.createElement('div');
    messageElement.className = 'module-grammar-check-card__message';
    messageElement.textContent = message;
    card.append(messageElement);

    if (replacements.length > 0) {
      const replacementsElement = document.createElement('div');
      replacementsElement.className = 'module-grammar-check-card__replacements';

      for (const replacement of replacements.slice(0, MAX_CARD_REPLACEMENTS)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'module-grammar-check-card__button';
        button.textContent = replacement;
        button.addEventListener('click', () => {
          this.#hideCard();
          this.#replace(
            activeMatch.match.offset,
            activeMatch.match.length,
            replacement
          );
        });
        replacementsElement.append(button);
      }

      card.append(replacementsElement);
    }

    const word = this.#wordFor(activeMatch.match);
    const actionsElement = document.createElement('div');
    actionsElement.className = 'module-grammar-check-card__actions';

    const ignoreRuleButton = document.createElement('button');
    ignoreRuleButton.type = 'button';
    ignoreRuleButton.className = 'module-grammar-check-card__link';
    ignoreRuleButton.textContent = i18n('icu:grammarCheckIgnoreRule', {
      rule: ruleDescription || ruleId,
    });
    ignoreRuleButton.addEventListener('click', () => {
      this.#hideCard();
      void this.#ignore('rule', ruleId);
    });
    actionsElement.append(ignoreRuleButton);

    const ignoreWordButton = document.createElement('button');
    ignoreWordButton.type = 'button';
    ignoreWordButton.className = 'module-grammar-check-card__link';
    ignoreWordButton.textContent = i18n('icu:grammarCheckIgnoreWord', { word });
    ignoreWordButton.addEventListener('click', () => {
      this.#hideCard();
      void this.#ignore('word', word);
    });
    actionsElement.append(ignoreWordButton);

    card.append(actionsElement);

    this.#positionCard(activeMatch.range.getBoundingClientRect());
  }

  /**
   * Places the card above the flagged text, flipping below only when there is
   * not enough room above, and keeps it inside the window.
   */
  #positionCard(anchor: DOMRect): void {
    const card = this.#card;
    if (card === undefined) {
      return;
    }

    // The card is already in the DOM, so this measures the freshly rendered
    // content rather than the previous one.
    const { width, height } = card.getBoundingClientRect();

    let top = anchor.top - height - CARD_GAP;
    if (top < VIEWPORT_MARGIN) {
      top = anchor.bottom + CARD_GAP;
    }

    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, anchor.left),
      Math.max(VIEWPORT_MARGIN, maxLeft)
    );

    card.style.left = `${Math.round(left)}px`;
    card.style.top = `${Math.round(top)}px`;
  }

  /**
   * Header showing which language the server detected, with a picker so the
   * user can correct it. Picking a language pins it; "detect" clears the pin.
   */
  #buildLanguageRow(): HTMLDivElement | undefined {
    const { i18n } = this.#options;
    const detected = this.#detectedLanguage;
    if (detected === undefined) {
      return undefined;
    }

    if (this.#languages === undefined) {
      void this.#loadLanguages();
    }

    const row = document.createElement('div');
    row.className = 'module-grammar-check-card__language';

    const label = document.createElement('span');
    label.className = 'module-grammar-check-card__language-label';
    label.textContent = i18n('icu:grammarCheckDetectedLanguage', {
      language: detected.name,
    });
    row.append(label);

    const select = document.createElement('select');
    select.className = 'module-grammar-check-card__select';
    select.setAttribute(
      'aria-label',
      i18n('icu:grammarCheckChangeLanguage__title')
    );

    const automaticOption = document.createElement('option');
    automaticOption.value = '';
    automaticOption.textContent = i18n('icu:grammarCheckLanguage__automatic');
    select.append(automaticOption);

    const options = this.#languages ?? [
      { label: detected.name, value: detected.code },
    ];
    for (const { label: optionLabel, value } of options) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = optionLabel;
      select.append(option);
    }

    // Reflect what is actually in effect, not just the stored setting.
    select.value =
      this.#requestLanguage === AUTO_DETECT_LANGUAGE
        ? ''
        : this.#requestLanguage;

    select.addEventListener('change', () => {
      this.#hideCard();
      void this.#pinLanguage(select.value);
    });

    row.append(select);

    return row;
  }

  async #loadLanguages(): Promise<void> {
    let languages: Array<{ label: string; value: string }> = [];
    try {
      const status = await window.Events.getLanguageToolStatus();
      languages = status.languages.map(({ name, longCode }) => ({
        label: name,
        value: longCode,
      }));
    } catch {
      // A missing language list only costs us the picker options.
    }

    if (this.#disposed) {
      return;
    }

    this.#languages = languages;

    const activeMatch = this.#cardMatch;
    if (activeMatch !== undefined) {
      this.#showCard(activeMatch);
    }
  }

  async #pinLanguage(language: string): Promise<void> {
    await window.Events.setLanguageToolLanguage(language);
    this.#detectedLanguage = undefined;
    // Re-reads the setting and re-checks when the request language changed.
    await this.#refreshConfig();
  }

  async #ignore(kind: 'word' | 'rule', value: string): Promise<void> {
    await window.Events.ignoreGrammarSuggestion({
      kind,
      value,
      language: this.#effectiveLanguage(),
    });
    this.checkNow();
  }

  #ensureCard(): HTMLDivElement {
    if (this.#card !== undefined) {
      return this.#card;
    }

    const card = document.createElement('div');
    card.className = 'module-grammar-check-card';
    card.setAttribute('role', 'dialog');
    card.addEventListener('mouseleave', this.#hideCard);

    document.body.append(card);
    this.#card = card;

    return card;
  }

  readonly #hideCard = (): void => {
    this.#cardMatch = undefined;
    if (this.#card === undefined) {
      return;
    }
    this.#card.remove();
    this.#card = undefined;
  };
}
