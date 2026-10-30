/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The frame a transcript BLOCK wears, per render style.
 *
 * A tool call is not the only block in the timeline: thinking, a system
 * notice, a task result and a goal injection are the same shape — a header that
 * states the thing, a body that opens on demand. Before this module each of
 * them spelled the card's frame out itself, so `toolRenderStyle` reached the
 * tool rows and left every neighbour in the old card: a compact transcript sat
 * between thinking and notices drawn as cards, which is a setting that half
 * applies.
 *
 * Pure class strings, no DOM and no Preact — the same split `gutter.ts` uses,
 * and for the same reason: the styles are asserted without mounting anything.
 *
 *  - `card`    — the bordered, rounded block Kabmo has always shipped.
 *  - `compact` — a bare header row; the body hangs off a dashed rail.
 *  - `trace`   — a header row with a node, on the transcript's rail.
 *  - `minimal` — the quietest: small type, no frame, a dashed body.
 *
 * The CURSOR and HOVER classes are deliberately NOT here: whether a block can
 * be toggled is a per-block fact (`canToggle`), not a property of the style.
 */

import type { ToolRenderMode } from '@/shared/lib/chat/timeline/tool-render-mode';

export interface BlockChrome {
  /** Outer wrapper. Empty for the frameless styles. */
  root: string;
  /** The framed surface; empty when the style has no frame. */
  frame: string;
  /** The header row (a `<button>` when the block can be toggled). */
  header: string;
  /** The leading glyph. */
  icon: string;
  /** The block's name. */
  title: string;
  /** The one line under the title while collapsed. */
  subtitle: string;
  /** The body container. */
  body: string;
  /** `trace` only: the node this block places on its own rail. */
  node?: string;
}

const CARD: BlockChrome = {
  root: '',
  frame: 'overflow-hidden rounded-xl border border-ink/10 bg-paper transition-colors hover:border-ink/20',
  header: 'flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors',
  icon: 'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
  title: 'text-[12px] font-semibold tracking-tight text-ink',
  subtitle: 'truncate font-mono text-[10.5px] text-ink/45',
  body: 'border-t border-ink/8 bg-canvas/40 px-3 py-3',
};

const COMPACT: BlockChrome = {
  root: '',
  frame: '',
  header: 'flex w-full items-center gap-2 px-1.5 py-1 text-left transition-colors',
  icon: 'flex shrink-0 items-center justify-center',
  title: 'shrink-0 text-[12px] font-semibold tracking-tight text-ink',
  subtitle: 'truncate font-mono text-[10.5px] text-ink/45',
  body: 'ml-5 mt-0.5 overflow-hidden border-l border-dashed border-ink/15 py-2 pl-3',
};

const TRACE: BlockChrome = {
  root: 'relative pl-4',
  frame: '',
  header: 'flex w-full items-center gap-2 px-1.5 py-1 text-left transition-colors',
  icon: 'flex shrink-0 items-center justify-center',
  title: 'shrink-0 text-[12px] font-semibold tracking-tight text-ink',
  subtitle: 'truncate font-mono text-[10.5px] text-ink/45',
  body: 'mb-1 ml-[3.5px] overflow-hidden border-l border-ink/10 py-2 pl-3',
  // Placed at the root's left edge with no translate: the rail is a 1px line at
  // `left-[3.5px]`, so an 8px node at `left-0` has its centre on that line
  // (measured: node 315 / rail 315). A `-translate-x-[3.5px]` here put the node
  // 3.5px left of its own rail — the exact drift the tool row avoids.
  node: 'absolute left-0 top-[9px] flex h-2 w-2 items-center justify-center rounded-full bg-ink/20',
};

const MINIMAL: BlockChrome = {
  root: '',
  frame: '',
  header: 'flex w-full items-baseline gap-1.5 px-1 py-0.5 text-left transition-colors',
  icon: 'flex shrink-0 self-center items-center justify-center',
  title: 'shrink-0 text-[11.5px] font-medium text-ink/70',
  subtitle: 'min-w-0 truncate font-mono text-[10.5px] text-ink/45',
  body: 'my-1.5 overflow-hidden rounded-md border border-dashed border-ink/15 px-3 py-2.5',
};

const BY_MODE: Record<ToolRenderMode, BlockChrome> = {
  card: CARD,
  compact: COMPACT,
  trace: TRACE,
  minimal: MINIMAL,
};

export function blockChrome(mode: ToolRenderMode): BlockChrome {
  return BY_MODE[mode];
}

/**
 * The left inset non-block content needs so the `trace` rail does not strike it.
 *
 * A trace BLOCK reserves the rail's column itself (`mx-3` gutter plus `pl-4`), so
 * its node sits at the rail and its text starts 16px past it. Prose, a notice
 * body, a diagnostic note and the summary card reserve nothing — they start at
 * `px-3` (12px) — and the rail, measured at x=315 in a 1440px window, landed
 * 4px INSIDE the first character of the answer. Measured with the rail's own
 * box: text elements at 311–979 against a rail at 315–316.
 *
 *  - `text`  (`ml-4`): transparent prose and the standalone intent. 16px puts
 *    the box past the rail's 16.5px edge and the text at 28px, exactly where a
 *    block's own content sits.
 *  - `boxed` (`ml-5`): a card with a background or a left border — the error
 *    strip, the diagnostic note, the summary. 20px clears the node's 8px width
 *    so the rail never runs across a fill.
 *
 * A phone needs neither: there the rail is at 3.5px and content already starts
 * at 12px (measured: rail x=20, nodes x=20, text clear).
 */
export function traceInset(mode: ToolRenderMode, isMobile: boolean, boxed = false): string {
  if (mode !== 'trace' || isMobile) return '';
  return boxed ? 'ml-5' : 'ml-4';
}
