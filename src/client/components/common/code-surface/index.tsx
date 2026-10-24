/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The code surface: CodeMirror 6, coloured by Shiki.
 *
 * What this replaced, and why it is a mount rather than a component tree: the
 * old surface was a transparent `<textarea>` over a Shiki-highlighted `<pre>`,
 * with Kabmo's own line windowing, wrap measurement, undo stack, multi-cursor
 * replication, find matcher and gutter geometry. Typing on a 4 800-line file
 * cost a measured 59.6 ms median, because every keystroke re-tokenized the
 * visible window and replaced the whole highlight layer's HTML; CM6 costs
 * 2.1 ms and the figure is flat from 8 000 to 20 000 lines, because it renders
 * and tokenizes only its viewport.
 *
 * Two decisions are load-bearing and both are stated elsewhere: Shiki stays the
 * tokenizer (`shiki.ts` — the app has one palette, and a lezer build would cover
 * 48 of the 59 ids `shiki-langs` knows), and the handle's contract is unchanged
 * (`CodeSurfaceHandle`), which is what keeps the find widget, the outline jump,
 * the line jump and the search reveal working without knowing about CM6.
 *
 * The host is a BOUNDED box. Measured: an unconstrained host grows to the
 * document's height (363 758 px at 20 000 lines), and then the scroll geometry,
 * the gutter and the restore path all become the outer scroller's problem. CM6
 * owns its own scroller, and it hands that element to its owner through
 * `onScroller` (a `ref` cannot reach a node the component does not render, and
 * the restore has to re-arm when the view mounts).
 */

import { useImperativeHandle, useLayoutEffect, useRef } from 'preact/hooks';
import { forwardRef } from 'preact/compat';
import type { CSSProperties } from 'preact';
import { EditorView } from '@codemirror/view';

import { createDocumentCache, type DocumentCache } from '@/client/components/common/code-surface/documents';
import { cancelScrollRestore } from '@/client/hooks/editor/use-scroll-restore';
import { runSurfaceCommand } from '@/client/components/common/code-surface/keymap';
import { setFindMarks, type MarkRange } from '@/client/components/common/code-surface/marks';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

export interface CodeSurfaceHandle {
  /** Current selection offsets in the buffer, or null before the view mounts. */
  getSelection(): { start: number; end: number } | null;
  /** Select `[start, end)`; `focus` moves keyboard focus into the editor. */
  select(start: number, end: number, focus?: boolean): void;
  /** Replace the buffer as one undoable edit, caret at `[caretStart, caretEnd)`, focus unchanged. */
  applyDocument(value: string, caretStart: number, caretEnd: number): void;
  /** Run an editor command by name (the palette's path into the editor). */
  runCommand(command: EditorCommand): void;
  /**
   * Bring the line holding `offset` into view WITHOUT moving the caret — what
   * "step to the next match" needs: the user's focus stays in the find field
   * while the match scrolls under it.
   */
  revealOffset(offset: number): void;
}

export interface CodeSurfaceProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Shiki language id, already resolved from the file name. */
  language: string;
  wordWrap: boolean;
  /** Which cached `EditorState` this document owns — a tab switch applies another. */
  documentKey: string;
  /** Find matches (document offsets) to paint; the current one is marked. */
  marks?: readonly MarkRange[];
  currentMark?: number;
  /** Commands the editor does not own (find bar chords, word wrap, save). */
  onCommand?: (command: EditorCommand) => void;
  /** A viewer: both `readOnly` and `editable(false)`, so nothing can write. */
  readOnly?: boolean;
  /** Font family / size / line height (the zoom control and the font setting). */
  style?: CSSProperties;
  /** Padding around the document, in px. */
  padding?: number;
  /** `data-testid` for the scroller, so the e2e layer can address it. */
  scrollTestId?: string;
  /**
   * The element that actually scrolls, reported on mount and cleared on unmount.
   *
   * It exists only once the view does, and it is CodeMirror's (`view.scrollDOM`)
   * — a caller that needs to remember the reader's position (`useScrollRestore`)
   * cannot reach it through a `ref`, so the surface hands it over.
   */
  onScroller?: (element: HTMLElement | null) => void;
  className?: string;
}

export const CodeSurface = forwardRef<CodeSurfaceHandle, CodeSurfaceProps>(function CodeSurface(
  {
    value,
    onValueChange,
    language,
    wordWrap,
    documentKey,
    marks,
    currentMark,
    onCommand,
    readOnly = false,
    style,
    padding = 16,
    scrollTestId,
    onScroller,
    className,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  /** The document the live state holds, so a switch can park it under the right key. */
  const docKeyRef = useRef<string>('');
  /** The last mark signature applied, so a re-render does not re-dispatch it. */
  const markSignatureRef = useRef<string>('');
  /**
   * True while this component writes the buffer itself.
   *
   * Load-bearing: the update listener reports every document change upward, and
   * an external sync (a file re-read, a tab switch) must not be reported back as
   * the user's edit — the write path would then arm an autosave for a change
   * nobody typed.
   */
  const writingRef = useRef(false);

  // Live mirrors: the state's own extensions close over these, and rebuilding
  // the state because a callback identity moved would drop the undo history.
  const onChangeRef = useRef(onValueChange);
  onChangeRef.current = onValueChange;
  const onCommandRef = useRef(onCommand);
  onCommandRef.current = onCommand;
  const onScrollerRef = useRef(onScroller);
  onScrollerRef.current = onScroller;
  /** The marks as of the last render, for the re-apply a document switch owes. */
  const marksRef = useRef<readonly MarkRange[]>(marks ?? []);
  const currentMarkRef = useRef(currentMark ?? -1);
  marksRef.current = marks ?? [];
  currentMarkRef.current = currentMark ?? -1;

  // One cache for the component's life: it owns the per-document states.
  const cacheRef = useRef<DocumentCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = createDocumentCache({
      wordWrap,
      readOnly,
      onDocChange: (next) => {
        if (writingRef.current) return;
        onChangeRef.current(next);
      },
      onState: (state) => {
        const key = docKeyRef.current;
        if (key) cacheRef.current?.remember(key, state);
      },
      onCommand: (command) => onCommandRef.current?.(command),
    });
  }

  // Mount once. Every later change is a state swap or a dispatch — never a
  // second view, which would drop the undo history the cache exists to keep.
  useLayoutEffect(() => {
    const host = hostRef.current;
    const cache = cacheRef.current;
    if (!host || !cache) return;

    docKeyRef.current = documentKey;
    const view = new EditorView({
      state: cache.stateFor(documentKey, language, value),
      parent: host,
    });
    viewRef.current = view;
    if (scrollTestId) view.scrollDOM.dataset.testid = scrollTestId;
    onScrollerRef.current?.(view.scrollDOM);

    return () => {
      onScrollerRef.current?.(null);
      view.destroy();
      viewRef.current = null;
    };
    // Mount only: the effects below own every later change, and re-running this
    // one would rebuild the view (and its history).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A different document: park the live state, then apply the other one.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const cache = cacheRef.current;
    if (!view || !cache) return;
    if (docKeyRef.current === documentKey) return;
    cache.remember(docKeyRef.current, view.state);
    docKeyRef.current = documentKey;
    view.setState(cache.stateFor(documentKey, language, value));
    // The cached state carries the configuration it was CREATED with, and
    // `setState` installs that wholesale — so the current wrap/read-only pair is
    // re-applied, or a tab opened while wrap was off comes back unwrapped.
    view.dispatch({ effects: cache.currentEffects() });
    syncExternal(view, value, writingRef);
    // The marks belonged to the previous document's offsets, and the field lives
    // in that state. A fresh state starts empty, so this re-applies whatever the
    // new document's owner asked for rather than leaving a stale set behind.
    markSignatureRef.current = '';
    view.dispatch({
      effects: setFindMarks.of({ marks: marksRef.current, current: currentMarkRef.current }),
    });
    // `value` is deliberately absent: this effect is about the KEY moving, and
    // the external sync below covers a document whose bytes were replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentKey]);

  // The parent replaced the buffer (a re-read, a refresh, a replace-all).
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view || docKeyRef.current !== documentKey) return;
    syncExternal(view, value, writingRef);
  }, [value, documentKey]);

  // Wrap and read-only are per-view settings: reconfiguring keeps the document,
  // the selection and the history, which is what a wrap toggle must not disturb.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const cache = cacheRef.current;
    if (!view || !cache) return;
    const effects = cache.optionsEffects({ wordWrap, readOnly });
    if (effects.length > 0) view.dispatch({ effects });
  }, [wordWrap, readOnly]);

  // Find marks: a field write, never a re-tokenize.
  useLayoutEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const list = marks ?? [];
    const signature = `${currentMark ?? -1}:${list.map((mark) => `${mark.start}-${mark.end}`).join(',')}`;
    if (signature === markSignatureRef.current) return;
    markSignatureRef.current = signature;
    view.dispatch({ effects: setFindMarks.of({ marks: list, current: currentMark ?? -1 }) });
  }, [marks, currentMark]);

  useImperativeHandle(
    ref,
    () => ({
      getSelection: () => {
        const view = viewRef.current;
        if (!view) return null;
        const range = view.state.selection.main;
        return { start: range.from, end: range.to };
      },
      select: (start, end, focus = true) => {
        const view = viewRef.current;
        if (!view) return;
        view.dispatch({ selection: { anchor: start, head: end }, scrollIntoView: false });
        // `focus()` is CM6's own `focusPreventScroll`, which is what stops the
        // browser scrolling the caret into view a second time — the caller's
        // `revealOffset` is the only thing that scrolls.
        if (focus) view.focus();
      },
      applyDocument: (next, caretStart, caretEnd) => {
        const view = viewRef.current;
        if (!view) return;
        // Deliberately NOT wrapped in `writingRef`: this is a USER edit (the
        // find bar's replace), so it has to reach `onValueChange` exactly like
        // typing does. Suppressing it left the parent holding the pre-replace
        // buffer — the replacement was invisible to the autosave, and the next
        // render that compared `value` against the document wrote the OLD text
        // back over it (measured: replace-all, switch tab, come back → the
        // original text, and nothing on disk).
        //
        // One transaction, so ⌘Z undoes the whole replacement: a replace-all
        // that took one undo step per match is what the old surface had to
        // hand-roll a history for.
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: next },
          selection: { anchor: caretStart, head: caretEnd },
        });
      },
      runCommand: (command) => {
        const view = viewRef.current;
        if (!view) return;
        runSurfaceCommand(command, view, onCommandRef.current);
      },
      revealOffset: (offset) => {
        const view = viewRef.current;
        if (!view) return;
        const at = Math.max(0, Math.min(offset, view.state.doc.length));
        // A reveal is an explicit destination, so a restore still replaying the
        // remembered offset must stand down — otherwise its `ResizeObserver`
        // callback (which can run BEFORE the scroll event this dispatch causes)
        // writes the old position back and the view never moves.
        cancelScrollRestore(view.scrollDOM);
        view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'nearest', yMargin: 24 }) });
        // `y: 'nearest'` is the rule the old surface hand-rolled: a reveal only
        // scrolls when the target is outside the visible band, so stepping
        // through matches does not jump the whole view on every step.
      },
    }),
    [],
  );

  const hostStyle = {
    ...style,
    // The document's padding, read back by the theme as a CSS variable so a
    // per-layout value needs no theme reconfigure.
    '--surface-pad': `${padding}px`,
  } as CSSProperties;

  return <div ref={hostRef} className={className} style={hostStyle} />;
});

/**
 * Write `value` into the view when it differs from what the document holds.
 *
 * The guard is the whole function: the parent re-renders on every keystroke, so
 * an unguarded write would dispatch a full-document replace on each one — both a
 * second edit and a fresh undo entry per character.
 */
function syncExternal(view: EditorView, value: string, writingRef: { current: boolean }): void {
  if (value === view.state.doc.toString()) return;
  writingRef.current = true;
  try {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  } finally {
    writingRef.current = false;
  }
}
