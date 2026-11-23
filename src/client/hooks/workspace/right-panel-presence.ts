/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The right side of the workspace: is anything of it on screen, and what happens
 * when the panel it was asked to show cannot fit.
 *
 * Two facts, one owner, because they are the same question asked twice. The
 * editor column keeps its width even while the right panel is suppressed, so
 * "the side is on" means "the editor, the panel, or both" — and a toggle that
 * reads its own `hidden` flag instead would either claim a side is on screen
 * when nothing is, or hide a visible column on the next click.
 *
 * `WorkspacePanels` is the only place that measures the group, so it is the only
 * place that can answer whether the panel fits; the answer travels up here
 * because the control that asked (the navbar's toggle, the `⌥⌘J` chord) is the
 * layout's. A panel that silently fails to appear is the defect: the flag the
 * click flipped stays true, so the next click looks like it does nothing.
 *
 * Three ways the refusal is announced, and each is once:
 *
 * - **The FIRST suppression of a load is silent.** A window that is narrow from
 *   the start never had the panel on screen, so nothing was lost; a warning
 *   toast on every load at 900px is noise, not information.
 * - **The panel DISAPPEARING is announced** — a resize, or an editor column the
 *   user just opened — because the message names what would make it fit.
 * - **A click on a side that has nothing on screen is answered on demand**: the
 *   crossing rule cannot see it, since the suppression was already true.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

const REFUSAL =
  'The right panel needs more room: widen the window, close the editor column, or pick the phone layout.';

/**
 * How long after mount a suppression is still the LOAD settling rather than the
 * panel being taken away.
 *
 * A session restores its stored layout in several passes — the panel widths, the
 * editor's tab list, the right side's own flags — so a 900px window draws the
 * panel for a frame and then drops it. That is not a loss the user can see, and
 * warning about it put a toast on every narrow-window load. A crossing after
 * this window is a real one: a resize, or an editor column the user opened.
 */
const SETTLE_MS = 1500;

export interface RightPanelPresenceArgs {
  pushToast: (message: string, tone?: ToastTone) => void;
  /** The editor column is on screen and holds its width. */
  showEditor: boolean;
  /** The side is not put away (`!rightSide.hidden`). */
  sideShown: boolean;
  /** The side's own switch, used when a click has something to do. */
  toggleSide: () => void;
}

export interface RightPanelPresence {
  /** The panel is asked for and there is no room for it. */
  suppressed: boolean;
  /** Something of the side — the editor, the panel, or both — is on screen. */
  sideVisible: boolean;
  /**
   * Handed to `WorkspacePanels`; it reports the fit decision every render, and
   * `null` until the group has been measured.
   *
   * The `null` is what makes "the first suppression of a load is silent"
   * possible: the resolver answers "fits" before it has an area, so without it
   * the first measured frame looked like a panel being taken away and warned on
   * every load at a narrow window.
   */
  report: (suppressed: boolean | null) => void;
  /** The navbar's control and the chord: reads `sideVisible`, refuses out loud. */
  toggle: () => void;
}

export function useRightPanelPresence({
  pushToast,
  showEditor,
  sideShown,
  toggleSide,
}: RightPanelPresenceArgs): RightPanelPresence {
  const [suppressed, setSuppressed] = useState<boolean | null>(null);
  const announced = useRef(false);
  const mountedAt = useRef(Date.now());

  const announce = useCallback(() => {
    if (announced.current) return;
    if (Date.now() - mountedAt.current < SETTLE_MS) return;
    announced.current = true;
    pushToast(REFUSAL, 'warning');
  }, [pushToast]);

  useEffect(() => {
    if (suppressed !== true) {
      // A panel that came back clears the "already said so" mark, so losing it
      // again is a new crossing the user may need to hear about.
      if (suppressed === false) announced.current = false;
      return;
    }
    announce();
  }, [suppressed, announce]);

  const report = useCallback((next: boolean | null) => setSuppressed(next), []);
  const sideVisible = showEditor || suppressed !== true;

  const toggle = useCallback(() => {
    if (sideShown && !sideVisible) {
      announce();
      return;
    }
    toggleSide();
  }, [announce, sideShown, sideVisible, toggleSide]);

  return { suppressed: suppressed === true, sideVisible, report, toggle };
}
