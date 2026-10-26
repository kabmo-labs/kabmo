/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The active palette, published for the NATIVE shell that hosts this page.
 *
 * A shell's launch overlay is drawn before the page exists, so it cannot read
 * CSS — and the shells have no copy of the theme catalog. The page therefore
 * answers `window.__kabmoPalette()`, and each shell stores the answer for the
 * next cold start: the one launch where nothing is running to ask.
 *
 * Same indirection as `__kabmoBack` and `__kabmoResume`, and for the same
 * reason — the page owns the state, the shell only knows the moment to ask.
 * Read at CALL time rather than captured, so a theme changed in Settings is the
 * answer the next launch gets, with no reload in between.
 *
 * Inert in a browser (nothing calls it), which is why it is installed
 * unconditionally rather than gated on a user agent.
 */

import {
  SHELL_PALETTE_PROPERTY,
  shellPalette,
  shellPaletteWire,
} from '@/shared/lib/theme/shell-palette';
import { currentThemeId } from '@/client/hooks/ui/theme';

/** The palette of the theme on `<html>` right now, as the shell paints it. */
export function activeShellPalette() {
  return shellPalette(currentThemeId());
}

/**
 * The answer the shells actually read.
 *
 * The WIRE string rather than the object, because four native parsers consume
 * it and Android's `org.json` is a stub in a JVM unit test — a JSON answer
 * would leave the parser that most needs pinning as the one that cannot be.
 */
export function activeShellPaletteWire(): string {
  return shellPaletteWire(activeShellPalette());
}

/** Install `window.__kabmoPalette`. Idempotent — a hot reload re-runs it. */
export function installPalettePublisher(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[SHELL_PALETTE_PROPERTY] = activeShellPaletteWire;
}
