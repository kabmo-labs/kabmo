/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Mounts a ghostty-web terminal on a container and keeps it bound to a PTY.
 *
 * Extracted from the view component so the mount lifecycle (WASM import, fit
 * addon, input wiring, observers) stays readable and the component remains a
 * render layer. Everything the caller must know travels through `callbacks`;
 * the returned handle is the only way back in.
 *
 * Three behaviours here are deliberate:
 *
 * - **Attach waits for a real grid.** The terminal panel stays mounted while
 *   its view is CSS-hidden (that is what keeps a shell alive across panel
 *   switches), and a hidden container measures 0px — fitting is skipped and the
 *   terminal keeps its 80x24 default. Attaching then would create the shell at
 *   a size the panel never had, and the retained scrollback would replay at
 *   that width forever. So attach is driven by the same ResizeObserver that
 *   detects the panel becoming visible.
 * - **Raw bytes in, raw bytes out.** ghostty-web's WASM parser accepts a
 *   `Uint8Array`, so a character split across two PTY reads is reassembled by
 *   the parser rather than by a decode step here. `onData` text is forwarded
 *   unless it is a legacy X10 mouse report, which is a latin-1 byte payload
 *   (see `shared/lib/workspace/terminal/input.ts`).
 * - **The renderer is dynamically imported on purpose.** ghostty-web is
 *   ~700 KB and is only needed once the terminal panel is opened, so it stays
 *   out of the initial client bundle.
 *
 * A theme change cannot recolor a running terminal: the WASM palette is fixed
 * when the terminal is created and ANSI cells carry resolved RGB. `setTheme`
 * therefore rebuilds the terminal with the new palette and clears it; the
 * caller reattaches the socket so the server replays the retained scrollback.
 * `clear()` after every open/reset is not cosmetic — the WASM allocator reuses
 * pages and can hand a fresh terminal the previous screen's cells.
 */

import type { FitAddon, Ghostty, Terminal } from 'ghostty-web';
import { terminalInputFrame } from '@/shared/lib/workspace/terminal/input';
import {
  installCellMetrics,
  waitForTerminalFonts,
  watchTerminalFonts,
} from '@/client/components/workspace/terminal-panel/fonts';
import { installFullWidthFit } from '@/client/components/workspace/terminal-panel/fit';
import { createGridAnnouncer } from '@/client/components/workspace/terminal-panel/grid';
import { attachTouchScroll, handleKeyNavigation } from '@/client/components/workspace/terminal-panel/navigation';
import { holdAcrossWrite, watchPointerPress } from '@/client/components/workspace/terminal-panel/scroll-hold';
import {
  getTerminalTheme,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK_BYTES,
} from '@/client/data/theme/terminal';

export interface TerminalMountCallbacks {
  /** Keystrokes, paste, mouse reports — straight to the PTY. */
  onInput: (data: string) => void;
  /** Non-UTF-8 payloads (legacy X10 mouse reports), as latin-1 bytes. */
  onBinaryInput: (bytes: Uint8Array) => void;
  /** The grid changed; the PTY must be resized to match. */
  onGridChange: (cols: number, rows: number) => void;
  /** The terminal is measurable and knows its size; attach with these. */
  onReady: (cols: number, rows: number) => void;
  /** Viewport scrolled away from the live bottom. */
  onScrolledUpChange: (scrolledUp: boolean) => void;
}

export interface TerminalMount {
  /** Raw PTY output. Bytes, not text: the WASM parser reassembles them. */
  write: (bytes: Uint8Array) => void;
  /**
   * Lay the retained scrollback out at the size it was drawn for, then fit the
   * panel. Grid reports are suppressed until the replay has been consumed.
   */
  writeReplay: (bytes: Uint8Array, cols: number, rows: number) => void;
  /** Drop the buffer and reset the cursor — used when the shell is replaced. */
  reset: () => void;
  focus: () => void;
  /** The shell's DECCKM state, read when a key-bar button is pressed. */
  applicationCursorKeys: () => boolean;
  /** The current selection, empty when nothing is selected. */
  getSelection: () => string;
  /** Feed text in as a paste, with bracketed-paste markers when requested. */
  paste: (text: string) => void;
  scrollToBottom: () => void;
  /**
   * Rebuild the terminal with another palette. The caller must reattach the
   * socket afterwards: the rebuilt terminal has no scrollback of its own.
   */
  setTheme: (themeId: string) => void;
  dispose: () => void;
}

interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  disposables: { dispose(): void }[];
}

/**
 * Mount the terminal inside `container`. Resolves to null when the module could
 * not be loaded or the component unmounted while importing.
 */
export async function mountTerminal(
  container: HTMLElement,
  themeId: string,
  callbacks: TerminalMountCallbacks,
  isCancelled: () => boolean,
): Promise<TerminalMount | null> {
  // One dynamic import, and the WASM module is loaded once per page. Fonts are
  // fetched in parallel: the renderer measures its cell box at `open()`, and a
  // face that lands after that is repaired by `watchTerminalFonts`. Dynamic on
  // purpose: ghostty-web and its ~424 KB WASM are only needed once the panel is
  // opened, so a static import would put them in every page's initial bundle.
  const module = await import('ghostty-web');
  const [ghostty] = await Promise.all([module.Ghostty.load(), waitForTerminalFonts()]);
  if (isCancelled()) return null;

  let currentThemeId = themeId;
  let current: TerminalInstance | null = null;
  let replaying = false;
  let fitTimer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | null = null;
  let disposed = false;

  const wire = (instance: TerminalInstance): void => {
    const { term } = instance;
    // ghostty-web's custom handler returns TRUE to consume the event, the
    // inverse of xterm's contract. `handleKeyNavigation` is written for this
    // one.
    term.attachCustomKeyEventHandler((event: globalThis.KeyboardEvent) => handleKeyNavigation(term, event));
    instance.disposables.push(
      term.onScroll((viewportY: number) => callbacks.onScrolledUpChange(viewportY > 0)),
      term.onData((data: string) => {
        const frame = terminalInputFrame(data);
        if (frame.bytes) callbacks.onBinaryInput(frame.bytes);
        else callbacks.onInput(frame.text);
      }),
      // FitAddon changes the grid on fit; the shell has to hear about it or a
      // TUI keeps drawing at the old width. The report goes through the settle
      // gate in `grid.ts` — a fit during the panel's opening animation is a
      // squeezed grid, not a size to send. Reports are dropped while the replay
      // is being laid out: that grid belongs to the recorded history, not the
      // panel.
      term.onResize(() => {
        if (replaying) return;
        grid.schedule();
      }),
    );
  };

  const create = (nextThemeId: string): TerminalInstance => {
    const term = new module.Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: TERMINAL_FONT_SIZE,
      fontFamily: TERMINAL_FONT_FAMILY,
      theme: getTerminalTheme(nextThemeId),
      // A byte budget, not xterm's line count. See `theme/terminal.ts`.
      scrollback: TERMINAL_SCROLLBACK_BYTES,
      // No `convertEol`: the PTY already emits CRLF, and converting a lone LF
      // would re-introduce the line-feed doubling a real terminal avoids.
      smoothScrollDuration: 0,
      ghostty: ghostty as Ghostty,
    });
    term.open(container);
    installCellMetrics(term);
    // The WASM allocator reuses pages: a fresh terminal can inherit the previous
    // screen's cells until something overwrites them. Clear before the first
    // byte is shown.
    term.clear();
    const fitAddon = new module.FitAddon();
    term.loadAddon(fitAddon);
    installFullWidthFit(fitAddon, term);
    const instance: TerminalInstance = { term, fitAddon, disposables: [] };
    wire(instance);
    return instance;
  };

  const disposeInstance = (instance: TerminalInstance | null): void => {
    if (!instance) return;
    for (const disposable of instance.disposables) {
      try {
        disposable.dispose();
      } catch {}
    }
    try {
      instance.fitAddon.dispose();
    } catch {}
    try {
      instance.term.dispose();
    } catch {}
  };

  /**
   * Fit to the container. Returns false when no fit was possible — the panel is
   * hidden, or the cell has not been measured yet — which is what keeps the
   * terminal's 80×24 default from ever being announced as a grid.
   */
  const safeFit = (): boolean => {
    if (disposed) return false;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return false;
    const metrics = current?.term.renderer?.getMetrics();
    if (!metrics?.width || !metrics.height) return false;
    try {
      current?.fitAddon.fit();
      return true;
    } catch {
      return false;
    }
  };

  /** Fit now, once the terminal has consumed everything already queued. */
  const finishReplay = (): void => {
    if (disposed) return;
    replaying = false;
    safeFit();
    // The replay laid the terminal out at the recorded grid, so the panel's own
    // size has to be stated again: a resize the server already applied is a
    // no-op, and one it missed (a mount that measured a squeezed panel) is
    // corrected here instead of at the next page load.
    grid.restate();
    grid.schedule();
  };

  /**
   * Lay the retained scrollback out at the size it was drawn for, then converge
   * on the panel's grid. Re-wrapping history at another width leaves wrapped
   * fragments the shell's own redraw never clears.
   */
  const writeReplay = (bytes: Uint8Array, cols: number, rows: number): void => {
    const term = current?.term;
    if (!term) return;
    replaying = true;
    if (term.cols !== cols || term.rows !== rows) term.resize(cols, rows);
    if (bytes.length === 0) {
      // ghostty-web's `write('')` throws: its zero-length allocation is not a
      // valid TypedArray offset. Finish on the next frame instead.
      requestAnimationFrame(finishReplay);
      return;
    }
    term.write(bytes, finishReplay);
  };

  const grid = createGridAnnouncer({
    current: () => current?.term,
    fit: safeFit,
    // Focus is NOT taken here: the panel asks for it when it becomes the
    // visible view (`focus.ts`), and a terminal that grabs focus 120ms after
    // the grid settles would steal it back from whatever the user clicked in
    // the meantime.
    onReady: callbacks.onReady,
    onGridChange: callbacks.onGridChange,
  });

  const pointer = watchPointerPress(container);

  current = create(currentThemeId);
  safeFit();
  grid.schedule();

  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(() => {
      safeFit();
      // A panel that was hidden at mount becomes measurable here, which is when
      // the shell should be created — at its real size.
      grid.schedule();
    }, 35);
  });
  resizeObserver.observe(container);

  const stopFontWatch = watchTerminalFonts(() => {
    const term = current?.term;
    if (!term) return;
    const size = term.options.fontSize ?? TERMINAL_FONT_SIZE;
    // ghostty-web measures once; a font-size round-trip is its public way to
    // re-measure and resize the canvas.
    term.options.fontSize = size + 0.1;
    term.options.fontSize = size;
    safeFit();
    grid.schedule();
  });

  const touch = attachTouchScroll(container, () => current?.term ?? null);

  // The container may already be measurable (the view was active at mount), in
  // which case the observer never fires a first time.
  frame = requestAnimationFrame(() => {
    safeFit();
    grid.schedule();
  });

  return {
    write(bytes: Uint8Array) {
      const term = current?.term;
      if (!term) return;
      // ghostty-web snaps the viewport to the bottom on every write; see
      // `scroll-hold.ts` for why that made a stream impossible to select from.
      holdAcrossWrite(term, pointer, () => term.write(bytes));
    },
    writeReplay,
    reset() {
      const term = current?.term;
      if (!term) return;
      term.reset();
      // The rebuilt WASM terminal reuses pages; see `create`.
      term.clear();
      safeFit();
    },
    focus() {
      current?.term.focus();
    },
    applicationCursorKeys() {
      return current?.term.wasmTerm?.getMode(1, false) ?? false;
    },
    getSelection() {
      return current?.term.getSelection() ?? '';
    },
    paste(text: string) {
      current?.term.paste(text);
    },
    scrollToBottom() {
      current?.term.scrollToBottom();
    },
    setTheme(nextThemeId: string) {
      if (disposed || nextThemeId === currentThemeId) return;
      currentThemeId = nextThemeId;
      disposeInstance(current);
      current = create(nextThemeId);
      safeFit();
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      clearTimeout(fitTimer);
      grid.dispose();
      stopFontWatch();
      touch();
      pointer.stop();
      resizeObserver.disconnect();
      disposeInstance(current);
      current = null;
    },
  };
}

