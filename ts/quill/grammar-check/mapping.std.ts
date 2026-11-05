// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plain-text extraction for grammar checking.
 *
 * The text we send to LanguageTool is built from the Quill Delta. Quill indices
 * are positions in the concatenation of a Delta's `insert` values, where embeds
 * (mentions, emoji) count as a single character. Building the string the same
 * way means that a LanguageTool `offset` is directly usable as a Quill index,
 * with no conversion step.
 */

/** Mirrors Quill's placeholder for embeds, so tokens are not glued together. */
export const EMBED_PLACEHOLDER = '\uFFFC';

export type QuillOpLike = Readonly<{
  insert?: unknown;
  retain?: unknown;
  delete?: unknown;
}>;

export type ExtractedTextType = Readonly<{
  text: string;
  /** Quill indices of every embed in `text`, in ascending order. */
  embedOffsets: ReadonlyArray<number>;
}>;

export function extractTextFromOps(
  ops: ReadonlyArray<QuillOpLike>
): ExtractedTextType {
  let text = '';
  const embedOffsets: Array<number> = [];

  for (const op of ops) {
    const { insert } = op;
    if (typeof insert === 'string') {
      text += insert;
    } else if (insert !== undefined) {
      embedOffsets.push(text.length);
      text += EMBED_PLACEHOLDER;
    }
  }

  return { text, embedOffsets };
}

/**
 * Matches that overlap an embed cannot be replaced without destroying the
 * mention or emoji, so they are dropped rather than rendered.
 */
export function overlapsEmbed(
  offset: number,
  length: number,
  embedOffsets: ReadonlyArray<number>
): boolean {
  const end = offset + length;
  return embedOffsets.some(
    embedOffset => embedOffset >= offset && embedOffset < end
  );
}

/**
 * LanguageTool occasionally reports zero-length matches (e.g. for spacing
 * rules). They cannot be drawn or replaced, so they are skipped.
 */
export function isUsableMatch(
  offset: number,
  length: number,
  textLength: number
): boolean {
  if (length <= 0) {
    return false;
  }
  return offset >= 0 && offset + length <= textLength;
}
