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
import type { ShikiThemeNames } from '@/client/components/common/code-surface/shiki';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';
import { createSurfaceHandle, type CodeSurfaceHandle } from '@/client/components/common/code-surface/handle';
import { setFindMarks, type MarkRange } from '@/client/components/common/code-surface/marks';
import { syncExternal } from '@/client/components/common/code-surface/sync';
import { loadStreamMode, readyStreamMode } from '@/client/components/common/code-surface/stream-language';
import type { EditorCommand } from '@/shared/lib/code/editor/keymap';

export type { CodeSurfaceHandle } from '@/client/components/common/code-surface/handle';

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
  /**
   * The editor THEME, as CSS custom properties (`editorThemeVars`).
   *
   * Written on the host element, so the chrome repaints through CSS and a theme
   * switch costs one attribute write. Empty/absent means `auto`: every
   * declaration in `theme.ts` falls back to the app palette.
   */
  themeVars?: Record<string, string>;
  /** The two Shiki theme names to tokenize with (the same theme twice when the
   *  editor theme is explicit). Defaults to the app's dual pair. */
  themes?: ShikiThemeNames;
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
    themeVars,
    themes,
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
  /**
   * The text the view last REPORTED (or last wrote), so the per-render sync can
   * skip without materializing the document.
   *
   * `syncExternal` used to compare `value` against `doc.toString()`, which is a
   * full stringify on every render — and the parent re-renders on every
   * keystroke, so a large file paid it twice per character. Measured in Bun:
   * `toString()` is 7.2 ms at 20 MB, 13.7 ms at 30 MB, and the browser showed
   * the knee — 34 ms per keystroke at 20 MB, 67 ms at 30, 83 ms at 40. The
   * parent's `value` is the very string this component handed it, so the usual
   * comparison is one reference check.
   */
  const lastValueRef = useRef(value);

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
  /** The tokenizer themes, mirrored for the cache's first build. */
  const activeThemes = themes ?? SHIKI_THEMES;
  const themesRef = useRef<ShikiThemeNames>(activeThemes);
  themesRef.current = activeThemes;

  // One cache for the component's life: it owns the per-document states.
  const cacheRef = useRef<DocumentCache | null>(null);
  if (!cacheRef.current) {
    cacheRef.current = createDocumentCache({
      wordWrap,
      readOnly,
      themes: themesRef.current,
      onDocChange: (next) => {
        // Recorded BEFORE the writing guard: this is what the document holds,
        // whether or not the change came from the user.
        lastValueRef.current = next;
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
    lastValueRef.current = value;
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
    // `setState` installs that wholesale — so the current wrap/read-only pair
    // and the current editor theme are re-applied, or a tab opened while wrap
    // was off comes back unwrapped and a theme chosen since comes back stale.
    view.dispatch({ effects: cache.currentEffects(documentKey) });
    syncExternal(view, value, writingRef, lastValueRef);
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
    syncExternal(view, value, writingRef, lastValueRef);
  }, [value, documentKey]);

  // Wrap, read-only and the editor theme are per-view settings: reconfiguring
  // keeps the document, the selection and the history, which is what a wrap
  // toggle — or a colour change — must not disturb.
  useLayoutEffect(() => {
    const view = viewRef.current;
    const cache = cacheRef.current;
    if (!view || !cache) return;
    const effects = cache.optionsEffects({ wordWrap, readOnly, themes: activeThemes }, docKeyRef.current);
    if (effects.length > 0) view.dispatch({ effects });
  }, [wordWrap, readOnly, activeThemes.light, activeThemes.dark]);

  /**
   * The stream language: fetched for this document's language, installed when it
   * lands.
   *
   * The mode is a lazy import, so the document was created without a parser and
   * `bracketMatching()` answers textually until this reconfigure runs. A mode
   * that fails to load leaves that textual matcher, which is a worse answer
   * rather than a broken editor — `loadStreamMode` never rejects.
   *
   * Re-installed on a DOCUMENT SWITCH too: the compartment is per state, and a
   * cached tab coming back has whatever configuration it was created with.
   */
  useLayoutEffect(() => {
    const view = viewRef.current;
    const cache = cacheRef.current;
    if (!view || !cache) return;

    let cancelled = false;
    const install = (mode: unknown) => {
      if (cancelled || !mode) return;
      const live = viewRef.current;
      if (!live) return;
      const effects = cache.languageEffects(docKeyRef.current, mode as never);
      if (effects.length > 0) live.dispatch({ effects });
    };

    // Already loaded (a second tab in the same language): install immediately so
    // the tree exists on the first paint, not one microtask later.
    const ready = readyStreamMode(language);
    if (ready) {
      install(ready);
      return () => { cancelled = true; };
    }

    void loadStreamMode(language).then(install);
    return () => { cancelled = true; };
  }, [language, documentKey]);

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

  // Built once: the handle closes over refs, so a consumer holding it never
  // re-subscribes, and the view it reaches is whatever is live at the call.
  useImperativeHandle(ref, () => createSurfaceHandle({ view: viewRef, onCommand: onCommandRef }), []);

  const hostStyle = {
    ...themeVars,
    ...style,
    // The document's padding, read back by the theme as a CSS variable so a
    // per-layout value needs no theme reconfigure.
    '--surface-pad': `${padding}px`,
  } as CSSProperties;

  return (
    <div
      ref={hostRef}
      className={className}
      style={hostStyle}
      // The panel's drop handler claims a file drop in the CAPTURE phase when
      // the drag is over this element: CodeMirror's own `drop` handler inserts a
      // dropped file's TEXT into the document, which would rewrite the open file
      // on the next autosave. See `use-editor-drop.ts`.
      data-code-surface=""
    />
  );
});
