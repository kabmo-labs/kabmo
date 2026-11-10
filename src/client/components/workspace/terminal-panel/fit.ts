/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Fit the terminal's grid to the whole container.
 *
 * ghostty-web's `FitAddon.proposeDimensions` subtracts a hard-coded 15 px for
 * its in-canvas scrollbar before dividing by the cell width, so the grid always
 * stopped one to three columns short of the panel: with the terminal painting
 * its own background that showed as a strip, and a full-width TUI (tmux status
 * line, `htop`) ran out of room the panel visibly had. The scrollbar is drawn
 * INSIDE the canvas, 8 px at the right edge and only while scrolling, so the
 * reservation buys nothing here — it can overlap the last column instead.
 *
 * Everything else stays the addon's: it resizes only when the grid changes and
 * it still reads `renderer.getMetrics()`, which is Kabmo's measured cell box
 * (see `installCellMetrics` in `fonts.ts`).
 */

import type { FitAddon, Terminal } from 'ghostty-web';
import type { TerminalCellMetrics } from '@/client/components/workspace/terminal-panel/fonts';

export interface TerminalGrid {
  cols: number;
  rows: number;
}

/**
 * The grid a box of `width` × `height` CSS px holds, at the measured cell size.
 *
 * Pure, so the arithmetic is pinned without a renderer: it divides the FULL box,
 * with the container's own padding subtracted because the host may keep some.
 */
export function gridForContainer(
  width: number,
  height: number,
  metrics: Pick<TerminalCellMetrics, 'width' | 'height'>,
): TerminalGrid | null {
  if (!metrics.width || !metrics.height) return null;
  return {
    cols: Math.max(2, Math.floor(width / metrics.width)),
    rows: Math.max(1, Math.floor(height / metrics.height)),
  };
}

/** Replace the addon's proposal with `gridForContainer` over the live host. */
export function installFullWidthFit(fitAddon: FitAddon, term: Terminal): void {
  const addon = fitAddon as unknown as {
    proposeDimensions: () => TerminalGrid | undefined;
  };
  addon.proposeDimensions = () => {
    const host = term.element;
    const metrics = term.renderer?.getMetrics();
    if (!host || !metrics) return undefined;
    const style = getComputedStyle(host);
    const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
    return (
      gridForContainer(host.clientWidth - padX, host.clientHeight - padY, metrics) ?? undefined
    );
  };
}
