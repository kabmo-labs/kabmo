/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The diff panel's CodeMirror side: the two view shapes, their theme, and the
 * counts the toolbar prints.
 *
 * What this replaced: a unified-diff PARSER feeding two hand-built tables
 * (1 066 lines across `UnifiedView` / `SplitView` plus the diff half of
 * `diff-parser`), with a Shiki pass per row and its own wrapping rules.
 * `@codemirror/merge` does the diff itself and draws the rows, so a chunk is a
 * real editor range: the gutter markers, the deleted-chunk widgets and the
 * collapsed stretches are the extension's, not ours.
 *
 * Three facts about this API are load-bearing and none is guessable:
 *
 * - `getChunks` is a FUNCTION, not a field: `state.field(getChunks)` throws
 *   "Field is not present in this state". The counts do not need it either —
 *   `Chunk.build(a, b)` is the same line-level chunking without a view, which
 *   is what lets a badge be computed before anything is mounted.
 * - `collapseUnchanged` is CONFIG, so switching *Diff Only* ↔ *Full Code* is a
 *   compartment reconfigure. Re-mounting would drop the reader's scroll.
 * - The merge package's own colours are hardcoded hex. They are overridden with
 *   the app's palette variables, or a diff would be the one surface that ignores
 *   the theme.
 */

import { Compartment, EditorState, Text, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { Chunk, MergeView, diff, unifiedMergeView } from '@codemirror/merge';

import { shikiHighlight } from '@/client/components/common/code-surface/shiki';
import { surfaceTheme } from '@/client/components/common/code-surface/theme';

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
      backgroundColor: 'var(--theme-paper)',
      color: 'var(--theme-ink)',
      fontSize: 'inherit',
      fontFamily: 'inherit',
      lineHeight: 'inherit',
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-scroller': { fontFamily: 'inherit', fontSize: 'inherit', lineHeight: 'inherit' },
    '.cm-gutters': {
      backgroundColor: 'var(--theme-canvas)',
      color: 'color-mix(in srgb, var(--theme-ink) 30%, transparent)',
      border: 'none',
      borderRight: '1px solid color-mix(in srgb, var(--theme-ink) 10%, transparent)',
      fontFamily: 'inherit',
      fontSize: 'inherit',
      lineHeight: 'inherit',
    },
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {
      backgroundColor: 'color-mix(in srgb, var(--theme-error) 10%, transparent)',
    },
    '&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {
      backgroundColor: 'color-mix(in srgb, var(--theme-success) 10%, transparent)',
    },
    '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {
      background:
        'linear-gradient(color-mix(in srgb, var(--theme-error) 40%, transparent), color-mix(in srgb, var(--theme-error) 40%, transparent)) bottom/100% 2px no-repeat',
    },
    '&.cm-merge-b .cm-changedText': {
      background:
        'linear-gradient(color-mix(in srgb, var(--theme-success) 40%, transparent), color-mix(in srgb, var(--theme-success) 40%, transparent)) bottom/100% 2px no-repeat',
    },
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--theme-error)' },
    '&.cm-merge-b .cm-changedLineGutter': { background: 'var(--theme-success)' },
    '.cm-collapsedLines': {
      color: 'color-mix(in srgb, var(--theme-ink) 45%, transparent)',
      background: 'var(--theme-canvas)',
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
  /** `data-testid` for the scroller, so the e2e layer can address it. */
  scrollTestId: string;
  /** The element that scrolls, reported on mount and cleared on unmount. */
  onScroller: (element: HTMLElement | null) => void;
}

export interface DiffViewHandle {
  /** Swap the documents (a refresh, a stage, a discard). */
  setDocuments(original: string, next: string): void;
  /** Re-collapse or expand the unchanged stretches without re-mounting. */
  setCollapse(collapse: CollapseMode): void;
  setWordWrap(wordWrap: boolean): void;
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
    shikiHighlight(options.language),
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
      extensions: [...baseExtensions(options, wrap), collapse.of(unified(original))],
    }),
  });
  if (options.scrollTestId) view.scrollDOM.dataset.testid = options.scrollTestId;
  options.onScroller(view.scrollDOM);

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
    b: { doc: options.next, extensions: baseExtensions(options, wrap) },
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
    scroller: () => scroller,
    destroy: () => {
      options.onScroller(null);
      merge.destroy();
    },
  };
}

/**
 * Additions and deletions, counted from the SAME line-level diff the view draws.
 *
 * `Chunk.build` is the merge view's own chunking — a line-level diff, which is
 * what its rows are. `diff()` would be the wrong source here: it is a
 * CHARACTER diff, so changing `line 5` into `line 5 changed` reports one
 * insertion of `" changed"` and no deletion at all, and the badge would claim
 * two additions for two edited lines.
 *
 * Counting from the view's own chunks is also what makes the whitespace toggle
 * honest: a change folded out of the comparison is not a changed row on screen,
 * and it is not counted.
 */
export function countChanges(original: string, next: string): { additions: number; deletions: number } {
  const a = Text.of(original.split('\n'));
  const b = Text.of(next.split('\n'));
  let additions = 0;
  let deletions = 0;
  for (const chunk of Chunk.build(a, b)) {
    // `endA`/`endB` are the end of the chunk's last line, and equal the start
    // when the chunk covers no lines on that side (a pure insertion/deletion).
    if (chunk.endA > chunk.fromA) deletions += a.lineAt(chunk.endA).number - a.lineAt(chunk.fromA).number + 1;
    if (chunk.endB > chunk.fromB) additions += b.lineAt(chunk.endB).number - b.lineAt(chunk.fromB).number + 1;
  }
  return { additions, deletions };
}

/**
 * `original` with every whitespace-only change replaced by the new text.
 *
 * The toolbar's whitespace toggle means "do not show me formatting noise", and
 * the merge view compares DOCUMENTS — so the way to honour it is to make the two
 * sides agree there. The old table parser folded a `-`/`+` pair whose trimmed
 * text matched back into a context row; this does the same at the source, which
 * is why the toggle changes the CHUNKS rather than only their colour.
 *
 * Only line-for-line changes are folded: an inserted or deleted line is a real
 * change even when it is blank, and hiding it would make the file's line count
 * disagree with what is on screen.
 */
export function foldWhitespaceOnly(original: string, next: string): string {
  const changes = diff(original, next);
  let folded = original;
  // Back to front: an earlier splice would move every later offset.
  for (let index = changes.length - 1; index >= 0; index--) {
    const change = changes[index];
    const before = original.slice(change.fromA, change.toA);
    const after = next.slice(change.fromB, change.toB);
    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    if (beforeLines.length !== afterLines.length) continue;
    if (!beforeLines.every((line, lineIndex) => line.trim() === afterLines[lineIndex].trim())) continue;
    folded = folded.slice(0, change.fromA) + after + folded.slice(change.toA);
  }
  return folded;
}
