/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * When a terminal grid may be announced to the shell.
 *
 * A terminal's grid is a PTY size, and a PTY size is a `SIGWINCH`: the shell
 * answers each one by redrawing its prompt, and those redraws are output that
 * lives in the scrollback forever. The right panel opens with a width
 * transition, so fits during it measure a squeezed box — announcing one sent
 * `resize 5x37` to a real shell, which redrew its prompt hard-wrapped at five
 * columns. Worse, before the first fit the terminal still holds ghostty's 80×24
 * default, which looks like a plausible size: a reload announced `80x24` and the
 * shell answered by rewrapping its prompt at 80 columns. Both left garbage in
 * the history, and every later reload replayed one more block of it above the
 * live prompt, which is why the prompt marched down the panel.
 *
 * Two rules follow, and they are this module:
 *
 * - **A grid is announced only after it has held still** (`GRID_SETTLE_MS`), so
 *   a value read mid-animation never leaves the client.
 * - **A grid comes from a real fit**, never from the terminal's default: the
 *   caller's `fit()` reports whether the container was measurable, and the
 *   decision below is not even asked when it was not.
 */

import type { Terminal } from 'ghostty-web';

/** A grid below this is a panel mid-transition, not a size someone chose. */
export const MIN_REPORT_COLS = 10;
export const MIN_REPORT_ROWS = 5;
/** How long a grid must hold still before it is announced to the shell. */
export const GRID_SETTLE_MS = 120;

export type GridEvent =
  | { kind: 'ignore' }
  | { kind: 'attach'; cols: number; rows: number }
  | { kind: 'change'; cols: number; rows: number };

/**
 * Classify a measured grid against what has already been announced.
 *
 * Pure, so the rules can be pinned without a renderer, a timer or a socket.
 */
export function gridDecision(input: {
  cols: number;
  rows: number;
  attached: boolean;
  committed: { cols: number; rows: number };
}): GridEvent {
  const { cols, rows, attached, committed } = input;
  if (cols < MIN_REPORT_COLS || rows < MIN_REPORT_ROWS) return { kind: 'ignore' };
  if (!attached) return { kind: 'attach', cols, rows };
  if (cols === committed.cols && rows === committed.rows) return { kind: 'ignore' };
  return { kind: 'change', cols, rows };
}

export interface GridAnnouncerOptions {
  /** The live terminal; the announcer never holds it, a theme rebuild replaces it. */
  current: () => Terminal | undefined;
  /** Fit to the container. False when the panel is hidden or the cell unmeasured. */
  fit: () => boolean;
  onReady: (cols: number, rows: number) => void;
  onGridChange: (cols: number, rows: number) => void;
}

export interface GridAnnouncer {
  /** Announce after the grid has held still for `GRID_SETTLE_MS`. */
  schedule: () => void;
  /** Forget what was announced, so the next commit states the grid again. */
  restate: () => void;
  /** True once the first real grid has been announced. */
  isAttached: () => boolean;
  dispose: () => void;
}

export function createGridAnnouncer(options: GridAnnouncerOptions): GridAnnouncer {
  let committed = { cols: 0, rows: 0 };
  let attached = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const commit = (): void => {
    if (!options.fit()) return;
    const term = options.current();
    if (!term) return;
    const event = gridDecision({
      cols: term.cols,
      rows: term.rows,
      attached,
      committed,
    });
    if (event.kind === 'ignore') return;
    committed = { cols: event.cols, rows: event.rows };
    if (event.kind === 'attach') {
      attached = true;
      options.onReady(event.cols, event.rows);
      return;
    }
    options.onGridChange(event.cols, event.rows);
  };

  return {
    schedule() {
      clearTimeout(timer);
      timer = setTimeout(commit, GRID_SETTLE_MS);
    },
    restate() {
      committed = { cols: 0, rows: 0 };
    },
    isAttached: () => attached,
    dispose() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}
