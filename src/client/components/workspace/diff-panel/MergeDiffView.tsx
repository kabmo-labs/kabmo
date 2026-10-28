/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff body: CodeMirror's merge view, mounted once and reconfigured.
 *
 * The panel above this owns the toolbar, the git actions and the persisted view
 * choices; this owns the two editors. Keeping them apart is what lets a stage /
 * unstage / discard re-read the documents without re-mounting the editor (which
 * would drop the reader's scroll position, and does so on every action).
 *
 * `Diff Only` ↔ `Full Code` is a compartment reconfigure, not a re-fetch: the
 * documents are already both sides of the file, and the server's `-U<n>` probe
 * existed only because the old table renderer could not collapse anything.
 */

import { useEffect, useRef, useState } from 'preact/hooks';

import { useScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { EDITOR_LINE_HEIGHT } from '@/shared/lib/code/editor/typography';
import {
  countChanges,
  foldWhitespaceOnly,
} from '@/client/components/workspace/diff-panel/changes';
import {
  mountSplitDiff,
  mountUnifiedDiff,
  type DiffViewHandle,
} from '@/client/components/workspace/diff-panel/merge';
import type { DiffContentMode, DiffViewMode } from '@/client/components/workspace/diff-panel/Toolbar';

interface MergeDiffViewProps {
  /** The document before the change. */
  original: string;
  /** The document after it. */
  next: string;
  language: string;
  viewMode: DiffViewMode;
  contentMode: DiffContentMode;
  wordWrap: boolean;
  ignoreWhitespace: boolean;
  /** The tab this diff belongs to, so its offset is remembered per shape. */
  tabKey: string | null;
  /**
   * Additions and deletions of the pair actually on screen. Omitted by a host
   * that draws its own badge from the patch (the chat's tool card).
   */
  onCounts?: (counts: { additions: number; deletions: number }) => void;
  /**
   * The changed chunks in the pair on screen, and which one holds the caret.
   *
   * Reported rather than owned: the toolbar that draws "2 of 5" and the two
   * chevrons lives in the panel above, and it must read the same numbers the
   * view is stepping through.
   */
  onChunkPosition?: (position: { index: number; count: number }) => void;
  /**
   * The step command, handed UP so the toolbar can call it.
   *
   * A callback rather than a ref because the handle is created in an effect
   * that the toolbar's render cannot see; this runs after mount, once the view
   * exists, and is a no-op before that.
   */
  onStepChunk?: (step: (direction: 1 | -1) => void) => void;
  /** Nothing to compare (both sides empty). */
  empty: boolean;
  fontFamily: string;
  fontSize: number;
  /** The editor theme's CSS variables (`editorThemeVars`); absent means `auto`. */
  themeVars?: Record<string, string>;
  /** The two Shiki theme names to tokenize with. */
  themes?: { light: string; dark: string };
}

export function MergeDiffView({
  original,
  next,
  language,
  viewMode,
  contentMode,
  wordWrap,
  ignoreWhitespace,
  tabKey,
  onCounts,
  onChunkPosition,
  onStepChunk,
  empty,
  fontFamily,
  fontSize,
  themeVars,
  themes,
}: MergeDiffViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<DiffViewHandle | null>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  /** The pair the live view holds, so a change is a re-state rather than a re-mount. */
  const pairRef = useRef<{ original: string; next: string }>({ original, next });

  const left = ignoreWhitespace ? foldWhitespaceOnly(original, next) : original;

  // The scroll offset is per SHAPE: unified and split rows are different
  // heights, so one view's position says nothing about the other's. The hook
  // wires the element's own `scroll` listener when it is handed one, so there is
  // no binding to spread here.
  useScrollRestore({
    tabKey,
    surface: viewMode === 'split' ? 'split' : 'unified',
    element: scroller,
  });

  // Mount, and re-mount only when the SHAPE changes — the two shapes are
  // different objects (an `EditorView` and a `MergeView`), so there is nothing
  // to reconfigure between them.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || empty) return;
    const options = {
      original: left,
      next,
      language,
      wordWrap,
      collapse: contentMode,
      themes,
      scrollTestId: 'diff-scroller',
      onScroller: setScroller,
      onChunkPosition,
    } as const;
    const handle =
      viewMode === 'split' ? mountSplitDiff(host, { ...options }) : mountUnifiedDiff(host, { ...options });
    handleRef.current = handle;
    pairRef.current = { original: left, next };

    return () => {
      handle.destroy();
      handleRef.current = null;
    };
    // Re-mounted on the shape, the language, the emptiness and the THEME only:
    // every other input is a reconfigure below. A theme is baked into the
    // tokenizer plugin (Shiki is handed theme NAMES at tokenize time), so a
    // colour change rebuilds it — the documents are re-stated by the effect
    // below, and a diff has no history to lose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, language, empty, themes?.light, themes?.dark]);

  // Documents changed (a refresh, a stage, a discard, the whitespace toggle).
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    if (pairRef.current.original === left && pairRef.current.next === next) return;
    pairRef.current = { original: left, next };
    handle.setDocuments(left, next);
  }, [left, next]);

  useEffect(() => {
    handleRef.current?.setCollapse(contentMode);
  }, [contentMode]);

  useEffect(() => {
    handleRef.current?.setWordWrap(wordWrap);
  }, [wordWrap]);

  // The step command, published once the view exists. `stepChunk` reads the live
  // handle, so a callback held across a re-mount still steps the current view.
  useEffect(() => {
    onStepChunk?.((direction) => {
      handleRef.current?.stepChunk(direction);
    });
  }, [onStepChunk]);

  // Counts describe the pair ON SCREEN, so the badge cannot disagree with the
  // rows under it (git's own `+n/-n` still counts a hidden whitespace change).
  useEffect(() => {
    if (!onCounts) return;
    onCounts(empty ? { additions: 0, deletions: 0 } : countChanges(left, next));
  }, [left, next, empty, onCounts]);

  if (empty) {
    return (
      <div className="flex-1 flex items-center justify-center text-ink/40 font-mono text-xs p-8">
        No differences between working file and target.
      </div>
    );
  }

  return (
    <div
      ref={hostRef}
      className="flex-1 min-h-0 overflow-hidden bg-paper text-ink"
      style={{
        ...themeVars,
        fontFamily,
        fontSize: `${fontSize}px`,
        lineHeight: EDITOR_LINE_HEIGHT,
        // A short diff would otherwise leave the merge view's own height at the
        // panel's, which is what its `.cm-mergeView` rule expects.
        ['--surface-pad' as string]: '8px',
      }}
      // A read-only CodeMirror swallows `drop` too (its handler answers `true`
      // for a read-only state, which cancels the event), so a file dropped on a
      // diff would reach neither the panel's handler nor anything else. Marking
      // the host is what lets the enclosing drop target claim the gesture in the
      // CAPTURE phase and open the file — the same rule the code surface states.
      data-code-surface=""
    />
  );
}
