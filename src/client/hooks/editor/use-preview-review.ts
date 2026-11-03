/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The review surface's state for one previewed document: which block the judge
 * panel is open on, and the stored marks with their block identities.
 *
 * Whether the mode is ON is the editor panel's state (`useFileReviewMode`) — this
 * hook only answers "what happens while it is on", so the toolbar button and the
 * surface cannot disagree about it.
 *
 * ## Blocks come from the RENDER, never from the file
 *
 * The caller stores them from `MarkdownRenderer`'s `onBlocks`. That list is what
 * is actually on screen: a document the markdown healer cut short, or one a
 * plugin's directive replaced, renders fewer (or different) blocks than it has
 * paragraphs, and a mark must only ever attach to a block a reader can click.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';

import { useDocumentAnnotations } from '@/client/hooks/editor/use-document-annotations';
import { reconcileAnnotations, tallyAnnotations } from '@/shared/lib/markdown/review/reconcile';
import { emitReviewBlock, formatReviewBlock } from '@/shared/lib/markdown/review/prompt';
import type { BlockVerdict, DocumentAnnotation, MdBlock, ReviewTarget } from '@/shared/lib/markdown/blocks/types';

export interface UsePreviewReviewOptions {
  file: { name: string; path: string; root?: string | null; repo?: string | null };
  /** Review mode, owned by the editor's toolbar. */
  active: boolean;
}

export interface PreviewReviewState {
  /** Verdicts the renderer paints, keyed by block key. */
  marks: ReadonlyMap<string, BlockVerdict>;
  /** The block the judge panel is open on. */
  selected: string | null;
  selectedBlock: MdBlock | null;
  selectedAnnotation: DocumentAnnotation | null;
  /** Where that block was on screen when it was picked (the panel anchors there). */
  anchor: { top: number; left: number } | null;
  /** Stored marks whose block is no longer rendered — shown, never dropped. */
  outdated: DocumentAnnotation[];
  counts: { good: number; needsWork: number };
  loading: boolean;
  error: string | null;
  /** The render reports what it produced. */
  setBlocks: (blocks: MdBlock[]) => void;
  pick: (block: MdBlock, rect: DOMRect) => void;
  close: () => void;
  save: (input: { block: MdBlock; verdict: BlockVerdict; note: string }) => void;
  remove: (id: string) => void;
  /** Put the review in the composer draft. False when there is nothing to send. */
  send: () => boolean;
}

export function usePreviewReview({ file, active }: UsePreviewReviewOptions): PreviewReviewState {
  const [blocks, setBlocksState] = useState<MdBlock[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number } | null>(null);

  // Primitives, not the object: a caller builds `file` inline.
  const target = useMemo<ReviewTarget>(
    () => ({ path: file.path, root: file.root ?? null, repo: file.repo ?? null }),
    [file.path, file.root, file.repo],
  );
  const { annotations, loading, error, save, remove } = useDocumentAnnotations(target, active);

  const { attached, outdated } = useMemo(
    () => reconcileAnnotations(blocks, annotations),
    [blocks, annotations],
  );
  const marks = useMemo(
    () => new Map([...attached.values()].map((row) => [row.blockKey, row.verdict])),
    [attached],
  );
  const counts = useMemo(() => tallyAnnotations(attached), [attached]);
  const selectedBlock = useMemo(
    () => (selected ? blocks.find((block) => block.key === selected) ?? null : null),
    [blocks, selected],
  );

  const setBlocks = useCallback((next: MdBlock[]) => {
    // The render hands back fresh objects every parse; comparing identity would
    // store a new list on every keystroke for a document that did not change.
    setBlocksState((previous) => sameBlockKeys(previous, next) ? previous : next);
  }, []);

  const pick = useCallback((block: MdBlock, rect: DOMRect) => {
    setSelected(block.key);
    // `fixed` coordinates: the judge panel is drawn where the block WAS. It
    // closes on scroll instead of tracking, because a rendered document
    // rehydrates (mermaid, math, directives) and every one of those moves blocks.
    setAnchor({ top: rect.bottom + 6, left: Math.max(8, rect.left) });
  }, []);

  const close = useCallback(() => {
    setSelected(null);
    setAnchor(null);
  }, []);

  const saveBlock = useCallback<PreviewReviewState['save']>(
    ({ block, verdict, note }) => {
      void save({
        blockKey: block.key,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        verdict,
        note,
        quote: block.quote,
      });
    },
    [save],
  );

  const send = useCallback(() => {
    const block = formatReviewBlock({ path: file.path, annotations: [...attached.values()] });
    if (!block) return false;
    emitReviewBlock(block);
    return true;
  }, [attached, file.path]);

  return {
    marks,
    selected,
    selectedBlock,
    selectedAnnotation: selectedBlock ? attached.get(selectedBlock.key) ?? null : null,
    anchor,
    outdated,
    counts,
    loading,
    error,
    setBlocks,
    pick,
    close,
    save: saveBlock,
    remove: (id) => void remove(id),
    send,
  };
}

/** Same block list? Keys alone: the text a block shows is already in the HTML. */
function sameBlockKeys(left: readonly MdBlock[], right: readonly MdBlock[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((block, index) => block.key === right[index]?.key);
}
