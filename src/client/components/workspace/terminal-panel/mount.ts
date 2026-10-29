/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Mounts an xterm instance on a container and keeps it bound to a PTY.
 *
 * Extracted from the view component so the mount lifecycle (xterm import, fit
 * addon, input wiring, observers) stays readable and the component remains a
 * render layer. Everything the caller must know travels through `callbacks`;
 * the returned handle is the only way back in.
 *
 * Two behaviours here are deliberate:
 *
 * - **Attach waits for a real grid.** The terminal panel stays mounted while
 *   its view is CSS-hidden (that is what keeps a shell alive across panel
 *   switches), and a hidden container measures 0px — fitting is skipped and
 *   xterm keeps its 80x24 default. Attaching then would create the shell at a
 *   size the panel never had, and the retained scrollback would replay at that
 *   width forever. So attach is driven by the same ResizeObserver that detects
 *   the panel becoming visible.
 * - **Raw bytes in, raw bytes out.** `onData`/`onBinary` forward keystrokes
 *   untouched, and `write` takes a `Uint8Array` so xterm's streaming UTF-8
 *   decoder reassembles a character split across two PTY reads.
 * - **xterm and the WebGL addon are dynamically imported on purpose.** xterm is
 *   ~300 KB and the addon pulls a WebGL context into the panel; both stay out
 *   of the initial client bundle until the terminal panel is actually opened.
 *   The module shape varies by build, hence the probe pattern below.
 */

import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import { createWebglControl } from '@/client/components/workspace/terminal-panel/webgl';
import {
  getXtermTheme,
  NERD_SYMBOLS_FAMILY,
  XTERM_FONT_FAMILY,
  safePatchFitAddon,
  safePatchRenderService,
  type XtermCore,
  type XtermModule,
} from '@/client/data/theme/terminal';

export interface XtermMountCallbacks {
  /** Keystrokes, paste, mouse reports — straight to the PTY. */
  onInput: (data: string) => void;
  /** Non-UTF-8 payloads xterm reports separately (some mouse reports). */
  onBinaryInput: (data: string) => void;
  /** The grid changed; the PTY must be resized to match. */
  onGridChange: (cols: number, rows: number) => void;
  /** The terminal is measurable and knows its size; attach with these. */
  onReady: (cols: number, rows: number) => void;
  /** Viewport scrolled away from the live bottom. */
  onScrolledUpChange: (scrolledUp: boolean) => void;
}

export interface XtermMount {
  term: Terminal;
  fitAddon: FitAddon;
  /**
   * Lay the retained scrollback out at the size it was drawn for, then fit the
   * panel. Grid reports are suppressed until the replay has been consumed.
   */
  writeReplay: (bytes: Uint8Array, cols: number, rows: number) => void;
  /**
   * Hold or release the WebGL context. Releasing falls back to xterm's DOM
   * renderer, so the buffer stays readable while the panel is hidden; holding
   * again re-creates the context on the next shown frame.
   */
  setWebgl: (enabled: boolean) => void;
  dispose: () => void;
}

/**
 * Mount xterm inside `container`. Resolves to null when the module could not be
 * loaded or the component unmounted while importing.
 */
export async function mountXterm(
  container: HTMLElement,
  themeId: string,
  callbacks: XtermMountCallbacks,
  isCancelled: () => boolean,
): Promise<XtermMount | null> {
  // Dynamic on purpose: xterm is ~300 KB and is only needed once the terminal
  // panel is actually opened, so it stays out of the initial client bundle
  // (the module shape varies by build, hence the probes).
  const xtermModule = (await import('@xterm/xterm')) as unknown as XtermModule<typeof Terminal>;
  const fitModule = (await import('@xterm/addon-fit')) as unknown as XtermModule<typeof FitAddon>;

  const TerminalClass = xtermModule.Terminal || xtermModule.default?.Terminal || xtermModule.default;
  const FitAddonClass = fitModule.FitAddon || fitModule.default?.FitAddon || fitModule.default;
  if (!TerminalClass || !FitAddonClass || isCancelled()) return null;

  safePatchFitAddon(FitAddonClass);

  const term = new TerminalClass({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: 12,
    lineHeight: 1.25,
    fontFamily: XTERM_FONT_FAMILY,
    theme: getXtermTheme(themeId),
    // No `convertEol`: the PTY already emits CRLF, and converting a lone LF
    // would re-introduce the line-feed doubling a real terminal avoids.
    scrollback: 10000,
    scrollSensitivity: 1.5,
    fastScrollSensitivity: 5,
    smoothScrollDuration: 0,
    allowProposedApi: true,
  }) as Terminal;

  term.open(container);
  safePatchRenderService(term);

  // WebGL renderer: powerline glyphs stay seamless, and the context is held only
  // while this panel is on screen (`webgl.ts` owns that decision and the numbers
  // behind it — 541.8 MB of graphics in an 817.7 MB footprint). It is attached by
  // the caller, which is the only thing that knows whether this view is the one
  // being looked at.
  const webgl = await createWebglControl(term);

  const fitAddon = new FitAddonClass() as FitAddon;
  term.loadAddon(fitAddon);

  // The bundled Nerd Font symbols face may still be in flight (a phone has no
  // Nerd Font of its own). See the helper for why the atlas has to be dropped
  // once it lands.
  const stopNerdFaceWatch = refreshAtlasWhenNerdFaceLoads(term);

  term.attachCustomKeyEventHandler((event: globalThis.KeyboardEvent) => handleKeyNavigation(term, event));

  const disposables = [
    term.onScroll(() => {
      const buffer = term.buffer.active;
      callbacks.onScrolledUpChange(buffer.viewportY < buffer.baseY);
    }),
    term.onData((data: string) => callbacks.onInput(data)),
    term.onBinary((data: string) => callbacks.onBinaryInput(data)),
    // FitAddon changes the grid on fit; the shell has to hear about it or a TUI
    // keeps drawing at the old width. Reports are dropped while the replay is
    // being laid out: that grid belongs to the recorded history, not the panel.
    term.onResize(({ cols, rows }) => {
      if (replaying) return;
      callbacks.onGridChange(cols, rows);
    }),
  ];

  let attached = false;
  let fitTimer: ReturnType<typeof setTimeout> | null = null;
  let frame: number | null = null;
  /**
   * Set while the retained scrollback is being laid out at its recorded size.
   * That transient grid is not the panel's, so it must not be reported as a
   * resize — the shell would answer with a prompt repaint for a size the user
   * never chose, which is how a reattach used to print a second prompt.
   */
  let replaying = false;

  const safeFit = () => {
    if (isCancelled()) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const core = (term as unknown as XtermCore)._core;
    const dims = core?._renderService?.dimensions;
    if (!dims?.css?.cell?.width || !dims?.css?.cell?.height) return;
    try {
      fitAddon.fit();
    } catch {}
  };

  /** Fit now, once xterm has consumed everything already queued. */
  const fitAfterWrites = () => {
    term.write('', () => {
      if (isCancelled()) return;
      replaying = false;
      safeFit();
    });
  };

  /**
   * Lay the retained scrollback out at the size it was drawn for, then converge
   * on the panel's grid. Re-wrapping history at another width leaves wrapped
   * fragments the shell's own redraw never clears.
   */
  const writeReplay = (bytes: Uint8Array, cols: number, rows: number) => {
    replaying = true;
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    if (bytes.length === 0) {
      fitAfterWrites();
      return;
    }
    term.write(bytes, fitAfterWrites);
  };

  const attachIfSized = () => {
    if (attached || isCancelled()) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
    const core = (term as unknown as XtermCore)._core;
    if (!core?._renderService?.dimensions?.css?.cell?.width) return;
    attached = true;
    callbacks.onReady(term.cols, term.rows);
    term.focus();
  };

  const resizeObserver = new ResizeObserver(() => {
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      safeFit();
      // A panel that was hidden at mount becomes measurable here, which is when
      // the shell should be created — at its real size.
      attachIfSized();
    }, 35);
  });
  resizeObserver.observe(container);

  const touch = attachTouchScroll(container, term);

  // The container may already be measurable (the view was active at mount), in
  // which case the observer never fires a first time.
  frame = requestAnimationFrame(() => {
    safeFit();
    attachIfSized();
  });

  return {
    term,
    fitAddon,
    writeReplay,
    setWebgl: webgl.set,
    dispose() {
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(fitTimer ?? undefined);
      stopNerdFaceWatch();
      touch();
      for (const disposable of disposables) disposable.dispose();
      resizeObserver.disconnect();
      try {
        fitAddon.dispose();
      } catch {}
      try {
        term.dispose();
      } catch {}
    },
  };
}

/**
 * Re-rasterize the terminal once the bundled symbols face has loaded.
 *
 * xterm has no `document.fonts` listener: it rasterizes a glyph the first time
 * it draws it and keeps the result in a texture atlas, so a PUA glyph written
 * before the face arrived stays whatever the fallback painted — a tofu box —
 * for the life of the buffer. The browser does re-lay-out DOM text when a face
 * lands late (verified on the DOM renderer), but xterm's canvas does not get
 * that for free.
 *
 * `loadingdone` naming our own family is exactly the signal that this machine
 * had no Nerd Font of its own: the face is declared last in the stack and its
 * `unicode-range` covers only PUA, so a device with an installed Nerd Font
 * never fetches it (verified: zero requests with a local family present). That
 * makes this a no-op on the developer's laptop and the fix on a phone.
 *
 * `clearTextureAtlas()` drops the atlas and forces a full refresh, which is
 * what re-rasterizes the glyphs. It is a public API on `Terminal`, and the
 * atlas is small enough that a full refresh is cheap — this runs at most once
 * per page load.
 *
 * Returns a disposer.
 */
function refreshAtlasWhenNerdFaceLoads(term: Terminal): () => void {
  if (typeof document === 'undefined' || !document.fonts) return () => {};

  const onLoadingDone = (event: FontFaceSetLoadEvent) => {
    const loaded = [...event.fontfaces].some((face) => face.family.replace(/['"]/g, '') === NERD_SYMBOLS_FAMILY);
    if (!loaded) return;
    try {
      term.clearTextureAtlas();
    } catch {
      // A disposed terminal has no render service; nothing to refresh.
    }
  };

  document.fonts.addEventListener('loadingdone', onLoadingDone);
  return () => document.fonts.removeEventListener('loadingdone', onLoadingDone);
}

/** Shift+PageUp/Home/End scroll the viewport instead of reaching the shell. */
function handleKeyNavigation(term: Terminal, event: globalThis.KeyboardEvent): boolean {
  if (event.type !== 'keydown' || !event.shiftKey) return true;
  if (event.key === 'PageUp') { term.scrollPages(-1); return false; }
  if (event.key === 'PageDown') { term.scrollPages(1); return false; }
  if (event.key === 'Home') { term.scrollToTop(); return false; }
  if (event.key === 'End') { term.scrollToBottom(); return false; }
  if (event.key === 'ArrowUp') { term.scrollLines(-1); return false; }
  if (event.key === 'ArrowDown') { term.scrollLines(1); return false; }
  return true;
}

/** Touch drags scroll the scrollback; xterm has no touch handling of its own. */
function attachTouchScroll(container: HTMLElement, term: Terminal): () => void {
  let startY = 0;
  const onStart = (event: globalThis.TouchEvent) => {
    if (event.touches.length === 1) startY = event.touches[0].clientY;
  };
  const onMove = (event: globalThis.TouchEvent) => {
    if (event.touches.length !== 1) return;
    const deltaY = startY - event.touches[0].clientY;
    if (Math.abs(deltaY) < 16) return;
    term.scrollLines(Math.trunc(deltaY / 16));
    startY = event.touches[0].clientY;
  };
  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: true });
  return () => {
    container.removeEventListener('touchstart', onStart);
    container.removeEventListener('touchmove', onMove);
  };
}
