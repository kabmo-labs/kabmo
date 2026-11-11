/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A focus request the terminal could not serve yet.
 *
 * The panel asks for focus the moment it becomes the visible view, but the
 * element that takes focus is created by `mountTerminal`, whose ghostty-web
 * import resolves asynchronously. A request that lands inside that window used
 * to be dropped: the keystrokes of a freshly opened panel went to whatever had
 * focus before, and the user's only workaround was clicking the canvas first.
 * The latch keeps the request until a terminal exists, then serves it once.
 */

export interface FocusLatch {
  /** Ask the current terminal for focus; remembered while there is none. */
  request: () => void;
  /** The terminal exists now; serve a pending request and route later ones. */
  attach: (focus: () => void) => void;
  /** Forget the terminal — a pending request must not revive a disposed one. */
  detach: () => void;
}

export function createFocusLatch(): FocusLatch {
  let target: (() => void) | null = null;
  let pending = false;

  return {
    request() {
      if (target) target();
      else pending = true;
    },
    attach(focus) {
      target = focus;
      if (!pending) return;
      pending = false;
      focus();
    },
    detach() {
      target = null;
      pending = false;
    },
  };
}
