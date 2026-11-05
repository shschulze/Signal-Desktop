// Copyright 2020 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type { BrowserWindow } from 'electron';
import { ClipboardItem, Menu, clipboard, ipcMain } from 'electron';

import { maybeParseUrl } from '../ts/util/url.std.ts';
import type { MenuListType } from '../ts/types/menu.std.ts';
import type { LocalizerType } from '../ts/types/Util.std.ts';
import { APPLICATION_OCTET_STREAM } from '../ts/types/MIME.std.ts';
import { drop } from '../ts/util/drop.std.ts';
import type { LoggerType } from '../ts/types/Logging.std.ts';
import type { GrammarContextHintType } from '../ts/types/LanguageTool.std.ts';
import { handleAttachmentRequest } from './attachment_channel.main.ts';
import { ignoreSuggestion } from './language_tool.main.ts';

const MAX_REPLACEMENTS_IN_MENU = 5;

/**
 * Native context menus are built synchronously, but the grammar match under the
 * pointer is only known to the renderer. A short-lived hint bridges the two: the
 * renderer reports the match on right-mouse-down, and it is consumed when the
 * `context-menu` event follows.
 */
const HINT_TTL_MS = 2000;

type StoredHintType = Readonly<{
  at: number;
  hint: GrammarContextHintType;
}>;

const hints = new Map<number, StoredHintType>();

let hintListenerInstalled = false;

function installHintListener(): void {
  if (hintListenerInstalled) {
    return;
  }
  hintListenerInstalled = true;

  ipcMain.on('LanguageTool:contextHint', (event, hint) => {
    if (hint == null || typeof hint !== 'object') {
      return;
    }
    hints.set(event.sender.id, { at: Date.now(), hint });
  });
}

function takeHint(webContentsId: number): GrammarContextHintType | undefined {
  const stored = hints.get(webContentsId);
  hints.delete(webContentsId);

  if (stored === undefined) {
    return undefined;
  }
  if (Date.now() - stored.at > HINT_TTL_MS) {
    return undefined;
  }

  return stored.hint;
}

export const setup = (
  browserWindow: BrowserWindow,
  i18n: LocalizerType,
  logger: LoggerType
): void => {
  installHintListener();

  browserWindow.webContents.on('context-menu', (_event, params) => {
    const { editFlags } = params;
    const isLink = Boolean(params.linkURL);
    const isImage =
      params.mediaType === 'image' &&
      params.hasImageContents &&
      params.srcURL &&
      !params.selectionText.trim();

    const grammarHint = takeHint(browserWindow.webContents.id);

    const showMenu =
      params.isEditable ||
      editFlags.canCopy ||
      isLink ||
      isImage ||
      grammarHint !== undefined;

    if (!showMenu) {
      return;
    }

    const template: MenuListType = [];

    if (grammarHint !== undefined && params.isEditable) {
      const {
        message,
        replacements,
        offset,
        length,
        ruleId,
        ruleDescription,
        word,
        language,
      } = grammarHint;

      for (const replacement of replacements.slice(
        0,
        MAX_REPLACEMENTS_IN_MENU
      )) {
        template.push({
          label: replacement,
          click: () => {
            browserWindow.webContents.send('LanguageTool:replace', {
              offset,
              length,
              value: replacement,
            });
          },
        });
      }

      if (replacements.length === 0) {
        template.push({
          label: i18n('icu:contextMenuNoSuggestions'),
          enabled: false,
        });
      }

      template.push({
        label: message,
        enabled: false,
      });
      template.push({
        label: i18n('icu:grammarCheckIgnoreRule', {
          rule: ruleDescription || ruleId,
        }),
        click: () => {
          ignoreSuggestion({
            kind: 'rule',
            value: ruleId,
            language,
          });
          browserWindow.webContents.send('LanguageTool:recheck');
        },
      });
      template.push({
        label: i18n('icu:grammarCheckIgnoreWord', { word }),
        click: () => {
          ignoreSuggestion({
            kind: 'word',
            value: word,
            language,
          });
          browserWindow.webContents.send('LanguageTool:recheck');
        },
      });
      template.push({ type: 'separator' });
    }

    if (params.isEditable) {
      if (editFlags.canUndo) {
        template.push({ label: i18n('icu:editMenuUndo'), role: 'undo' });
      }
      // This is only ever `true` if undo was triggered via the context menu
      // (not ctrl/cmd+z)
      if (editFlags.canRedo) {
        template.push({ label: i18n('icu:editMenuRedo'), role: 'redo' });
      }
      if (editFlags.canUndo || editFlags.canRedo) {
        template.push({ type: 'separator' });
      }
      if (editFlags.canCut) {
        template.push({ label: i18n('icu:editMenuCut'), role: 'cut' });
      }
    }

    if (editFlags.canCopy || isLink || isImage) {
      let click;
      let label;

      if (isLink) {
        click = () => {
          drop(clipboard.writeText(params.linkURL));
        };
        label = i18n('icu:contextMenuCopyLink');
      } else if (isImage) {
        click = async () => {
          const parsedSrcUrl = maybeParseUrl(params.srcURL);
          if (!parsedSrcUrl || parsedSrcUrl.protocol !== 'attachment:') {
            return;
          }

          const urlIsViewOnce =
            parsedSrcUrl.searchParams.get('disposition') === 'temporary';
          if (urlIsViewOnce) {
            return;
          }

          const req = new Request(parsedSrcUrl, {
            method: 'GET',
          });

          try {
            const res = await handleAttachmentRequest(req);
            if (!res.ok) {
              return;
            }

            const contentType =
              res.headers.get('content-type') || APPLICATION_OCTET_STREAM;

            await clipboard.write([
              new ClipboardItem({
                [contentType]: new Blob([await res.arrayBuffer()], {
                  type: contentType,
                }),
              }),
            ]);
          } catch (error) {
            logger.error('Failed to load image', error);
          }
        };
        label = i18n('icu:contextMenuCopyImage');
      } else {
        label = i18n('icu:editMenuCopy');
      }

      template.push({
        label,
        role: isLink || isImage ? undefined : 'copy',
        click,
      });
    }

    if (editFlags.canPaste && !isImage) {
      template.push({ label: i18n('icu:editMenuPaste'), role: 'paste' });
    }

    // It seems like `canEditRichly` is unreliable for `contenteditable`
    // But `formControlType` will tell us if the element is some native
    // input/button/etc, and any `contenteditable` should be "none"
    const isLikelyRichTextEditor = params.formControlType === 'none';
    if (
      editFlags.canPaste &&
      (editFlags.canEditRichly || isLikelyRichTextEditor) &&
      !isImage
    ) {
      template.push({
        label: i18n('icu:editMenuPasteAndMatchStyle'),
        role: 'pasteAndMatchStyle',
      });
    }

    // Only enable select all in editors because select all in non-editors
    // results in all the UI being selected
    if (editFlags.canSelectAll && params.isEditable) {
      template.push({
        label: i18n('icu:editMenuSelectAll'),
        role: 'selectAll',
      });
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({
      window: browserWindow,
      frame: params.frame ?? undefined,
    });
  });
};
