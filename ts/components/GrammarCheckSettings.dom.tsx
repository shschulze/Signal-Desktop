// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { JSX } from 'react';

import type { LocalizerType } from '../types/Util.std.ts';
import { AxoButton } from '../axo/AxoButton.dom.tsx';
import { AxoTextField } from '../axo/fields/AxoTextField.dom.tsx';
import { AxoSelectItem } from '../axo/items/AxoSelectItem.dom.tsx';

export type GrammarCheckStatusType = 'unknown' | 'ready' | 'unreachable';

export type GrammarCheckSettingsProps = Readonly<{
  i18n: LocalizerType;
  /** Empty when the user has not configured a server. */
  url: string;
  /** Empty means "follow the app language". */
  language: string;
  languages: ReadonlyArray<{ label: string; value: string }>;
  status: GrammarCheckStatusType;
  onUrlChange: (url: string) => void;
  onLanguageChange: (language: string) => void;
  onTestConnection: () => void;
}>;

const MAX_URL_LENGTH = 2048;
const AUTOMATIC_LANGUAGE = 'auto';

export function toGrammarCheckStatus(
  state: 'unconfigured' | 'ready' | 'error'
): GrammarCheckStatusType {
  if (state === 'ready') {
    return 'ready';
  }
  if (state === 'unconfigured') {
    return 'unknown';
  }
  return 'unreachable';
}

export function GrammarCheckSettings({
  i18n,
  url,
  language,
  languages,
  status,
  onUrlChange,
  onLanguageChange,
  onTestConnection,
}: GrammarCheckSettingsProps): JSX.Element {
  let statusText: string | undefined;
  if (url.trim().length === 0) {
    statusText = i18n('icu:grammarCheckServer__notConfigured');
  } else if (status === 'ready') {
    statusText = i18n('icu:grammarCheckServer__reachable');
  } else if (status === 'unreachable') {
    statusText = i18n('icu:grammarCheckServer__unreachable');
  } else {
    statusText = i18n('icu:grammarCheckServer__description');
  }

  return (
    <>
      <div className="GrammarCheckSettings">
        <label
          className="GrammarCheckSettings__label"
          htmlFor="grammar-check-url"
        >
          {i18n('icu:grammarCheckServer__title')}
        </label>
        <AxoTextField.Root
          id="grammar-check-url"
          value={url}
          onValueChange={onUrlChange}
          maxGraphemes={MAX_URL_LENGTH}
          maxBytes={MAX_URL_LENGTH * 4}
        >
          <AxoTextField.Input
            placeholder="http://127.0.0.1:8081"
            spellCheck={false}
          />
        </AxoTextField.Root>
        <div className="GrammarCheckSettings__status">{statusText}</div>
        <AxoButton.Root
          variant="subtle-secondary"
          size="sm"
          onClick={onTestConnection}
        >
          {i18n('icu:grammarCheckServer__test')}
        </AxoButton.Root>
      </div>
      <AxoSelectItem.Root
        symbol="globe"
        label={i18n('icu:grammarCheckLanguage__title')}
        value={language.length > 0 ? language : AUTOMATIC_LANGUAGE}
        placeholder={i18n('icu:grammarCheckLanguage__title')}
        onValueChange={value => {
          onLanguageChange(value === AUTOMATIC_LANGUAGE ? '' : value);
        }}
        options={[
          {
            label: i18n('icu:grammarCheckLanguage__automatic'),
            value: AUTOMATIC_LANGUAGE,
          },
          ...languages,
        ]}
      />
    </>
  );
}
