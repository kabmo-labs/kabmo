/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a write must do to the viewport it inherited.
 *
 * ghostty-web's `writeInternal` ends with `viewportY !== 0 && scrollToBottom()`,
 * so EVERY chunk of PTY output re-anchors the view to the live end. A stream
 * (`tail -F`, a build log, `yes`) therefore cannot be read or selected at all:
 * a wheel-up was undone by the next chunk, and a drag that started on a line
 * ended on whatever had scrolled under the pointer by the release — measured on
 * the assembled panel, a two-row drag during a 100 lines/s stream copied twelve
 * lines.
 *
 * Three states hold the view, each for its own measured failure:
 *
 * - **Scrolled back** (`viewportY > 0`): nothing above the live line could be
 *   read while output kept arriving.
 * - **Pointer down**: a copy starts with a press, and the engine's own
 *   selection does not exist until the drag passes its 0.5-cell threshold, so
 *   the rows move out from under the gesture before there is anything to hold.
 * - **Selection exists**: a selection outlives the drag (drag, release, read,
 *   press ⌘C), and output arriving in that window used to scroll it away
 *   before the copy ran.
 *
 * Everything else follows the live output, which is what a terminal does.
 *
 * The hold is stated as an ABSOLUTE buffer row, not as a distance from the
 * bottom: as lines are appended the same content must stay on screen, so the
 * distance from the bottom has to grow with the scrollback. `heldTop` captures
 * that row before a write and `viewportYForTop` turns it back into a
 * `viewportY` after it. The write is synchronous, so the restore lands before
 * the next paint — the library's own snap is never shown.
 */

/** The absolute buffer row at the top of the viewport, or null when the view follows output. */
export function heldTop(input: {
  scrollback: number;
  viewportY: number;
  hasSelection: boolean;
  pointerHeld: boolean;
}): number | null {
  if (input.viewportY <= 0 && !input.hasSelection && !input.pointerHeld) return null;
  return input.scrollback - input.viewportY;
}

/** The `viewportY` that puts `top` back at the top of the viewport, or null at the bottom. */
export function viewportYForTop(input: { scrollback: number; top: number }): number | null {
  const viewportY = input.scrollback - input.top;
  return viewportY > 0 ? viewportY : null;
}

/**
 * The viewport methods the hold reads and drives.
 *
 * Narrow on purpose: `scrollLines` is how the library's own scroll path is
 * driven — it clamps, fires `onScroll` (which is what keeps the "Latest" button
 * honest) and repaints — while assigning `viewportY` directly skips all three.
 */
export interface HoldableViewport {
  getScrollbackLength: () => number;
  getViewportY: () => number;
  hasSelection: () => boolean;
  scrollLines: (amount: number) => void;
}

/**
 * Watch the press that starts a selection.
 *
 * `pointerdown` in the CAPTURE phase on the container: ghostty-web's selection
 * manager attaches its own mousedown and stops propagation once its scrollbar
 * wins, and the hold has to start at the press — before the engine's own
 * selection exists, because its drag threshold (half a cell) leaves a window in
 * which a stream has already moved the rows out from under the gesture.
 *
 * Release is watched on the WINDOW: a drag that ends outside the panel (over the
 * sidebar, or off the app) must end the hold too, or output stops following
 * forever.
 *
 * Returns the state the write path reads, plus its own teardown.
 */
export function watchPointerPress(container: HTMLElement): { pointerHeld: boolean; stop: () => void } {
  const state = { pointerHeld: false };
  const press = (): void => {
    state.pointerHeld = true;
  };
  const release = (): void => {
    state.pointerHeld = false;
  };
  container.addEventListener('pointerdown', press, true);
  globalThis.addEventListener('pointerup', release);
  globalThis.addEventListener('pointercancel', release);
  return {
    get pointerHeld() {
      return state.pointerHeld;
    },
    stop() {
      container.removeEventListener('pointerdown', press, true);
      globalThis.removeEventListener('pointerup', release);
      globalThis.removeEventListener('pointercancel', release);
    },
  };
}

/**
 * Run `write`, then put the viewport back where the reader left it.
 *
 * A no-op when nothing holds the view, so ordinary output still scrolls the way
 * a terminal should.
 */
export function holdAcrossWrite(
  viewport: HoldableViewport,
  state: { pointerHeld: boolean },
  write: () => void,
): void {
  const top = heldTop({
    scrollback: viewport.getScrollbackLength(),
    viewportY: viewport.getViewportY(),
    hasSelection: viewport.hasSelection(),
    pointerHeld: state.pointerHeld,
  });
  write();
  if (top === null) return;
  const target = viewportYForTop({ scrollback: viewport.getScrollbackLength(), top });
  if (target === null) return;
  const delta = target - viewport.getViewportY();
  if (delta === 0) return;
  try {
    // Positive `amount` scrolls toward the top, so a positive delta moves back.
    viewport.scrollLines(-delta);
  } catch {
    // A disposed terminal has no wasm buffer; the next mount starts at the bottom.
  }
}
