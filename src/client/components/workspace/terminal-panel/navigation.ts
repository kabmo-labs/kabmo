/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Keyboard and touch gestures the canvas renderer does not implement.
 *
 * ghostty-web's custom key handler returns `true` to CONSUME an event, which is
 * the inverse of xterm's contract. This module is written for ghostty's one:
 * an ordinary key must return false so the terminal's own encoder sees it.
 */

import type { Terminal } from 'ghostty-web';

/** Shift+PageUp/Home/End scroll the viewport instead of reaching the shell. */
export function handleKeyNavigation(term: Terminal, event: globalThis.KeyboardEvent): boolean {
  if (event.type !== 'keydown' || !event.shiftKey) return false;
  if (event.key === 'PageUp') { term.scrollPages(-1); return true; }
  if (event.key === 'PageDown') { term.scrollPages(1); return true; }
  if (event.key === 'Home') { term.scrollToTop(); return true; }
  if (event.key === 'End') { term.scrollToBottom(); return true; }
  if (event.key === 'ArrowUp') { term.scrollLines(-1); return true; }
  if (event.key === 'ArrowDown') { term.scrollLines(1); return true; }
  return false;
}

/** Touch drags scroll the scrollback; ghostty-web has no touch handling. */
export function attachTouchScroll(container: HTMLElement, getTerminal: () => Terminal | null): () => void {
  let startY = 0;
  const onStart = (event: globalThis.TouchEvent) => {
    if (event.touches.length === 1) startY = event.touches[0].clientY;
  };
  const onMove = (event: globalThis.TouchEvent) => {
    if (event.touches.length !== 1) return;
    const deltaY = startY - event.touches[0].clientY;
    if (Math.abs(deltaY) < 16) return;
    getTerminal()?.scrollLines(Math.trunc(deltaY / 16));
    startY = event.touches[0].clientY;
  };
  container.addEventListener('touchstart', onStart, { passive: true });
  container.addEventListener('touchmove', onMove, { passive: true });
  return () => {
    container.removeEventListener('touchstart', onStart);
    container.removeEventListener('touchmove', onMove);
  };
}
