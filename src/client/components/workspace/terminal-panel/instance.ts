/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One ghostty-web terminal and the addons bound to it.
 *
 * Split from `mount.ts` so the mount lifecycle (import, observers, replay,
 * focus) stays readable and this file owns only "make a terminal, wire it, tear
 * it down". The caller supplies `wire` because the event handlers it installs
 * close over the mount's own state (the replay gate, the grid announcer).
 */

import type { FitAddon, Ghostty, Terminal } from 'ghostty-web';
import { installCellMetrics } from '@/client/components/workspace/terminal-panel/fonts';
import { installFullWidthFit } from '@/client/components/workspace/terminal-panel/fit';
import { focusTerminalTextarea } from '@/client/components/workspace/terminal-panel/focus-target';
import {
  getTerminalTheme,
  TERMINAL_FONT_FAMILY,
  TERMINAL_FONT_SIZE,
  TERMINAL_SCROLLBACK_BYTES,
} from '@/client/data/theme/terminal';

export interface TerminalInstance {
  term: Terminal;
  fitAddon: FitAddon;
  disposables: { dispose(): void }[];
}

export function createTerminalInstance(
  module: { Terminal: typeof Terminal; FitAddon: typeof FitAddon },
  ghostty: Ghostty,
  container: HTMLElement,
  themeId: string,
  wire: (instance: TerminalInstance) => void,
): TerminalInstance {
  const term = new module.Terminal({
    cursorBlink: true,
    cursorStyle: 'block',
    fontSize: TERMINAL_FONT_SIZE,
    fontFamily: TERMINAL_FONT_FAMILY,
    theme: getTerminalTheme(themeId),
    // A byte budget, not xterm's line count. See `theme/terminal.ts`.
    scrollback: TERMINAL_SCROLLBACK_BYTES,
    // No `convertEol`: the PTY already emits CRLF, and converting a lone LF
    // would re-introduce the line-feed doubling a real terminal avoids.
    smoothScrollDuration: 0,
    ghostty,
  });
  term.open(container);
  installCellMetrics(term);
  // The WASM allocator reuses pages: a fresh terminal can inherit the previous
  // screen's cells until something overwrites them. Clear before the first byte
  // is shown.
  term.clear();
  // Only when the container is really on screen: the desktop mounts every view
  // hidden, and a hidden terminal must not take focus (or a keyboard).
  if (container.clientWidth > 0) focusTerminalTextarea(term);
  const fitAddon = new module.FitAddon();
  term.loadAddon(fitAddon);
  installFullWidthFit(fitAddon, term);
  const instance: TerminalInstance = { term, fitAddon, disposables: [] };
  wire(instance);
  return instance;
}

export function disposeTerminalInstance(instance: TerminalInstance | null): void {
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
}
