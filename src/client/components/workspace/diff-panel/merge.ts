/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff panel's CodeMirror side: the two view shapes and their theme.
 *
 * What this replaced: a unified-diff PARSER feeding two hand-built tables
 * (1 066 lines across `UnifiedView` / `SplitView` plus the diff half of
 * `diff-parser`), with a Shiki pass per row and its own wrapping rules.
 * `@codemirror/merge` does the diff itself and draws the rows, so a chunk is a
 * real editor range: the gutter markers, the deleted-chunk widgets and the
 * collapsed stretches are the extension's, not ours.
 *
 * Two neighbours own what used to live here, both split out at the per-file
 * ceiling and both with a boundary of their own: `chunks.ts` (stepping through
 * the changes) and `changes.ts` (what the toolbar's badge counts, and the
 * whitespace fold).
 *
 * Two facts about this API are load-bearing and none is guessable:
 *
 * - `collapseUnchanged` is CONFIG, so switching *Diff Only* ↔ *Full Code* is a
 *   compartment reconfigure. Re-mounting would drop the reader's scroll.
 * - The merge package's own colours are hardcoded hex. They are overridden with
 *   the app's palette variables, or a diff would be the one surface that ignores
 *   the theme.
 */

import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { MergeView, unifiedMergeView } from '@codemirror/merge';

import { shikiHighlight, type ShikiThemeNames } from '@/client/components/common/code-surface/shiki';
import { surfaceTheme } from '@/client/components/common/code-surface/theme';
import { diffFoldingExtensions } from '@/client/components/workspace/diff-panel/folding';
import {
  chunkPositionOf,
  chunkReporter,
  stepChunkIn,
  type ChunkPosition,
} from '@/client/components/workspace/diff-panel/chunks';

/** What the toolbar shows; `diff` collapses the unchanged stretches. */
export type CollapseMode = 'diff' | 'full';

/** The collapsed-stretch settings: git's own `-U3` shape, plus a minimum. */
const COLLAPSE = { margin: 3, minSize: 4 } as const;

/** Both sides of a diff are a READER here: the toolbar writes, not the editor. */
const READ_ONLY = [EditorState.readOnly.of(true), EditorView.editable.of(false)];

/**
 * The app's palette, applied to the merge package's own classes.
 *
 * `&.cm-merge-a` / `&.cm-merge-b` are spelled out because the extension's base
 * theme uses the same shape — an equally specific rule from a `theme` facet wins
 * on order, and a weaker one loses.
 */
function diffTheme(): Extension {
  return EditorView.theme({
    '&': {
      height: '100%',
      backgroundColor: 'var(--editor-bg, var(--theme-paper))',
      color: 'var(--editor-fg, var(--theme-ink))',
      fontSize: 'inherit',
      fontFamily: 'inherit',
      lineHeight: 'inherit',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg, var(--theme-canvas))',
      color: 'var(--editor-gutter-fg, color-mix(in srgb, var(--theme-ink) 30%, transparent))',
      border: 'none',
      borderRight: '1px solid var(--editor-border, color-mix(in srgb, var(--theme-ink) 10%, transparent))',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
    },
    // The diff bands follow the editor theme when one is chosen (its own
    // inserted/removed colours) and the app's signal pair otherwise.
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
      backgroundColor: 'var(--editor-removed, color-mix(in srgb, var(--theme-error) 10%, transparent))',
    },
    '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
      backgroundColor: 'var(--editor-added, color-mix(in srgb, var(--theme-success) 10%, transparent))',
    },
    // The per-token underline is deliberately NOT drawn, and it CANNOT be
    // removed from here: `@codemirror/merge`'s base theme paints a 2px gradient
    // along the bottom of every `.cm-changedText` / `.cm-deletedText` fragment,
    // and its rules are spelled with the `&light`/`&dark` prefixes that only
    // `EditorView.baseTheme` accepts — `EditorView.theme` throws
    // `RangeError: Unsupported selector: &light` (measured; it took the whole
    // merge view down with an empty host). `tailwind.css` therefore owns the
    // suppression, under the same `.cm-changedText` class. See the block there.
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {
      background: 'var(--editor-removed-gutter, var(--theme-error))',
    },
    '&.cm-merge-b .cm-changedLineGutter': {
      background: 'var(--editor-added-gutter, var(--theme-success))',
    },
    '.cm-collapsedLines': {
      color: 'color-mix(in srgb, var(--editor-fg, var(--theme-ink)) 45%, transparent)',
      background: 'var(--editor-bg, var(--theme-canvas))',
      fontSize: '11px',
    },
    '.cm-changeGutter': { width: '3px', paddingLeft: '1px' },
    '.cm-mergeView': { height: '100%' },
  });
}

export interface DiffViewOptions {
  /** The document before the change (HEAD for a staged diff, the index otherwise). */
  original: string;
  /** The document after it. */
  next: string;
  language: string;
  wordWrap: boolean;
  collapse: CollapseMode;
  /** The two Shiki theme names; absent keeps the app's dual pair. */
  themes?: ShikiThemeNames;
  /** `data-testid` for the scroller, so the e2e layer can address it. */
  scrollTestId: string;
  /** The element that scrolls, reported on mount and cleared on unmount. */
  onScroller: (element: HTMLElement | null) => void;
  /**
   * The chunk the selection is in, reported whenever it moves.
   *
   * Pushed from the view rather than polled by the toolbar: the position is a
   * property of the EDITOR's selection, and a caller that recomputed it on its
   * own render would print a number the view had already moved past.
   */
  onChunkPosition?: (position: ChunkPosition) => void;
}

export interface DiffViewHandle {
  /** Swap the documents (a refresh, a stage, a discard). */
  setDocuments(original: string, next: string): void;
  /** Re-collapse or expand the unchanged stretches without re-mounting. */
  setCollapse(collapse: CollapseMode): void;
  setWordWrap(wordWrap: boolean): void;
  /**
   * The changed chunks in the pair on screen, and which one holds the selection.
   *
   * `index` is 0-based, or -1 when the selection is not inside a chunk — which
   * is the normal state for a reader who has not stepped yet. The pair is
   * returned together because they are read in the same render and a caller
   * that fetched them separately could print "3 of 2".
   */
  chunkPosition(): ChunkPosition;
  /**
   * Move the selection to the next (`1`) or previous (`-1`) chunk, wrapping.
   *
   * False when there is nothing to step through, so the toolbar can leave its
   * buttons inert rather than silently doing nothing.
   */
  stepChunk(direction: 1 | -1): boolean;
  /** The element that actually scrolls, for scroll restore. */
  scroller(): HTMLElement | null;
  destroy(): void;
}

/** What `collapseUnchanged` is given, or `undefined` for the full file. */
function collapseConfig(collapse: CollapseMode): { margin: number; minSize: number } | undefined {
  return collapse === 'diff' ? COLLAPSE : undefined;
}

/** The extension stack both shapes share. */
function baseExtensions(options: DiffViewOptions, wrap: Compartment): Extension[] {
  return [
    ...READ_ONLY,
    lineNumbers(),
    // Folding (a brace rule then the editor's indentation rule), the fold
    // gutter that supplies the fold STATE field, and bracket pairing + guide.
    // A read-only viewer still folds — that is the whole point of it here.
    ...diffFoldingExtensions,
    shikiHighlight(options.language, options.themes),
    surfaceTheme(),
    diffTheme(),
    wrap.of(options.wordWrap ? EditorView.lineWrapping : []),
    // The browser's spellchecker underlines every identifier in a diff, and
    // autocorrect would be offered on code.
    EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
  ];
}

/** Replace a document wholesale — the diff is a reader, so there is no history to keep. */
function replaceDoc(view: EditorView, text: string): void {
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}

/** The Unified shape: one editor whose content IS the new document. */
export function mountUnifiedDiff(parent: HTMLElement, options: DiffViewOptions): DiffViewHandle {
  const collapse = new Compartment();
  const wrap = new Compartment();
  /** The pair the LIVE view is comparing; re-stated whenever collapse changes. */
  let original = options.original;

  const unified = (source: string): Extension =>
    unifiedMergeView({
      original: source,
      collapseUnchanged: collapseConfig(options.collapse),
      // The panel's toolbar owns stage/unstage/discard; per-chunk accept/reject
      // would be a second, weaker write path into the working tree.
      mergeControls: false,
      gutter: true,
      // Deleted lines are widgets, so the Shiki decorations cannot reach them;
      // leaving this on would colour them from a grammar the editor does not
      // have installed.
      syntaxHighlightDeletions: false,
    });

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: options.next,
      extensions: [
        ...baseExtensions(options, wrap),
        collapse.of(unified(original)),
        options.onChunkPosition ? chunkReporter(options.onChunkPosition) : [],
      ],
    }),
  });
  if (options.scrollTestId) view.scrollDOM.dataset.testid = options.scrollTestId;
  options.onScroller(view.scrollDOM);
  // Seeded like the caret: the reporter only fires on a CHANGE, so a freshly
  // mounted diff would otherwise print "0 of 0" over a file with changes.
  options.onChunkPosition?.(chunkPositionOf(view));

  return {
    setDocuments(nextOriginal, next) {
      original = nextOriginal;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        // The merge extension reads `original` from its own configuration, so a
        // new pair means reconfiguring it — a document-only dispatch would keep
        // comparing against the previous side.
        effects: collapse.reconfigure(unified(original)),
      });
    },
    setCollapse(mode) {
      options.collapse = mode;
      view.dispatch({ effects: collapse.reconfigure(unified(original)) });
    },
    setWordWrap(wordWrap) {
      options.wordWrap = wordWrap;
      view.dispatch({ effects: wrap.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
    },
    chunkPosition: () => chunkPositionOf(view),
    stepChunk: (direction) => stepChunkIn(view, direction),
    scroller: () => view.scrollDOM,
    destroy: () => {
      options.onScroller(null);
      view.destroy();
    },
  };
}

/** The Split shape: two editors, aligned by the merge view. */
export function mountSplitDiff(parent: HTMLElement, options: DiffViewOptions): DiffViewHandle {
  const wrap = new Compartment();
  const merge = new MergeView({
    parent,
    a: { doc: options.original, extensions: baseExtensions(options, wrap) },
    b: {
      doc: options.next,
      extensions: [
        ...baseExtensions(options, wrap),
        options.onChunkPosition ? chunkReporter(options.onChunkPosition) : [],
      ],
    },
    collapseUnchanged: collapseConfig(options.collapse),
    highlightChanges: true,
    gutter: true,
    orientation: 'a-b',
  });
  // The merge view's own element is the scroller: it styles `.cm-mergeView` with
  // a height and `overflow: auto`, and the two editors inside it do not scroll.
  const scroller = merge.dom;
  if (options.scrollTestId) scroller.dataset.testid = options.scrollTestId;
  options.onScroller(scroller);
  options.onChunkPosition?.(chunkPositionOf(merge.b));

  return {
    setDocuments(original, next) {
      replaceDoc(merge.a, original);
      replaceDoc(merge.b, next);
      // `chunks` is recomputed from the editors' states, so this re-runs the
      // diff against the new pair.
      merge.reconfigure({ collapseUnchanged: collapseConfig(options.collapse) });
    },
    setCollapse(mode) {
      options.collapse = mode;
      merge.reconfigure({ collapseUnchanged: collapseConfig(mode) });
    },
    setWordWrap(wordWrap) {
      options.wordWrap = wordWrap;
      const effects = wrap.reconfigure(wordWrap ? EditorView.lineWrapping : []);
      merge.a.dispatch({ effects });
      merge.b.dispatch({ effects });
    },
    // The B side is the file as it is now, which is the one a reader steps
    // through: `a` is the version being compared against and is read-only for a
    // different reason. Both sides carry the chunk field, so the count is the
    // same either way.
    chunkPosition: () => chunkPositionOf(merge.b),
    stepChunk: (direction) => stepChunkIn(merge.b, direction),
    scroller: () => scroller,
    destroy: () => {
      options.onScroller(null);
      merge.destroy();
    },
  };
}
