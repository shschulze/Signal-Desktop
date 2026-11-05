// Copyright 2026 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import type Quill from '@signalapp/quill-cjs';

const TEXT_NODE = 3;

export type TextLeafType = Readonly<{
  /** Index in Quill's coordinate space, which is also the LanguageTool offset. */
  index: number;
  length: number;
  textNode: Text;
}>;

type BlotLikeType = Readonly<{
  domNode: Node;
  length: () => number;
  children?: Readonly<{
    forEachAt: (
      index: number,
      length: number,
      callback: (
        child: BlotLikeType,
        offset: number,
        childLength: number
      ) => void
    ) => void;
  }>;
}>;

function collectLeaves(
  blot: BlotLikeType,
  base: number,
  result: Array<TextLeafType>
): void {
  const { children } = blot;

  if (children) {
    children.forEachAt(0, blot.length(), (child, offset) => {
      collectLeaves(child, base + offset, result);
    });
    return;
  }

  const length = blot.length();
  if (length <= 0) {
    return;
  }
  if (blot.domNode.nodeType !== TEXT_NODE) {
    // Embeds (mentions, emoji) occupy one index but cannot be highlighted or
    // replaced, so they are simply not addressable.
    return;
  }

  const textNode = blot.domNode as Text;
  if (!textNode.isConnected) {
    return;
  }

  result.push({ index: base, length, textNode });
}

/**
 * Every addressable text node, with the Quill index it starts at. Quill's blot
 * tree already knows the exact offsets, which avoids re-implementing its block
 * and embed rules against the DOM.
 */
export function collectTextLeaves(quill: Quill): Array<TextLeafType> {
  const result: Array<TextLeafType> = [];
  collectLeaves(quill.scroll, 0, result);
  return result;
}

/**
 * Builds a DOM range covering `[start, start + length)` in Quill indices. A
 * match may span several leaves (for example across a bold run); the returned
 * range then covers everything in between, which is what the user sees
 * highlighted.
 */
export function rangeForIndices(
  leaves: ReadonlyArray<TextLeafType>,
  start: number,
  length: number
): Range | undefined {
  if (length <= 0) {
    return undefined;
  }

  const end = start + length;
  let startNode: Text | undefined;
  let startOffset = 0;
  let endNode: Text | undefined;
  let endOffset = 0;

  for (const leaf of leaves) {
    const leafStart = leaf.index;
    const leafEnd = leaf.index + leaf.length;

    if (leafEnd <= start) {
      continue;
    }
    if (leafStart >= end) {
      break;
    }

    if (startNode === undefined) {
      startNode = leaf.textNode;
      startOffset = Math.max(start, leafStart) - leafStart;
    }

    endNode = leaf.textNode;
    endOffset = Math.min(end, leafEnd) - leafStart;
  }

  if (startNode === undefined || endNode === undefined) {
    return undefined;
  }
  if (startNode === endNode && endOffset <= startOffset) {
    return undefined;
  }

  const range = document.createRange();
  range.setStart(startNode, Math.min(startOffset, startNode.length));
  range.setEnd(endNode, Math.min(endOffset, endNode.length));

  if (range.collapsed) {
    return undefined;
  }

  return range;
}
