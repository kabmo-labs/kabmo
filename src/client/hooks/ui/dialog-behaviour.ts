/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The behaviour every dialog in the app owes the keyboard, in one hook.
 *
 * Three of the app's dialogs (Settings, About, the update sheet) shipped a scrim
 * with NO `role="dialog"`, NO `aria-modal`, no Escape handler and no focus
 * containment. Measured on the running console, with focus inside the About
 * sheet: Escape did nothing, and one `Tab` from the last control landed on the
 * page BEHIND the dialog (the "update" pill in the sidebar). A keyboard user
 * could not close the sheet or reach its controls reliably, which is the whole
 * of R-32.
 *
 * ## What it does, and why each part is not optional
 *
 * - **Focus moves into the panel on open.** Otherwise the first `Tab` walks the
 *   page behind the veil, which is exactly the measured failure.
 * - **`Tab`/`Shift+Tab` wrap inside the panel.** Native `<dialog>` does this for
 *   free, but the app's shells are `div`s because the layouts place them inside
 *   transformed subtrees; the wrap is therefore stated here.
 * - **Escape closes.** It is the key a keyboard user reaches for first.
 * - **Focus returns to the opener.** A dialog that drops focus on `<body>` makes
 *   the next `Tab` start from the top of the page.
 *
 * A dialog also traps the POINTER implicitly: its scrim covers the viewport, so
 * this hook only has to own the keyboard half.
 */

import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/** Everything inside a dialog that can take focus, in visual order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Focusable descendants that are actually rendered (a phone leaves panels in the DOM). */
function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export interface DialogBehaviourOptions {
  /** Whether the dialog is on screen. The hook is inert while false. */
  open: boolean;
  /** Close request, from Escape. */
  onClose: () => void;
  /**
   * Where focus lands on open. Defaults to the first focusable element; pass a
   * node to land on a specific control (a phone's list view, a form's first
   * field) or `null` for the panel itself.
   */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Wire a dialog's keyboard contract to `panelRef`.
 *
 * The panel must be the element that carries `role="dialog"`, so the label the
 * caller sets there is the label a screen reader announces.
 */
export function useDialogBehaviour(panelRef: RefObject<HTMLElement | null>, options: DialogBehaviourOptions): void {
  const { open, onClose, initialFocusRef } = options;
  // The element that opened the dialog, restored on close. Held in a ref so a
  // re-render does not overwrite it with an element inside the dialog.
  const openerRef = useRef<HTMLElement | null>(null);
  // The close callback changes identity on every parent render (it usually
  // closes over state); reading it through a ref keeps the listeners installed
  // exactly once per open instead of re-adding them on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    openerRef.current = (document.activeElement as HTMLElement | null) ?? null;
    const initial = initialFocusRef?.current ?? focusablesIn(panel)[0] ?? panel;
    // `preventScroll`: the panel may be taller than the viewport and the browser
    // would otherwise jump to the control it just focused.
    initial.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        // A dialog opened ON TOP of another (the notes sheet over About) must
        // close alone; the outer one never sees the key because this handler
        // stops it. Registration order is mount order, which is stack order.
        event.stopPropagation();
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusablesIn(panel);
      if (items.length === 0) {
        // Nothing to move to: keep focus on the panel rather than let the page
        // behind the veil take it.
        event.preventDefault();
        panel.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // `!panel.contains(active)` covers the case the measurement found: focus
      // was placed OUTSIDE on open (the panel had not mounted yet), and the
      // first Tab must pull it in rather than continue from there.
      if (!active || !panel.contains(active)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore only when the opener is still in the document: a dialog that
      // closed because its opener was removed (a deleted row) has nothing to
      // return to, and focusing a detached node silently does nothing.
      const opener = openerRef.current;
      if (opener && opener.isConnected) opener.focus({ preventScroll: true });
      openerRef.current = null;
    };
  }, [open, panelRef, initialFocusRef]);
}
