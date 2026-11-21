/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tab-style panel that is REVEALED shows a view, not its catalog.
 *
 * A panel can be put away whole — the navbar's right-side toggle, the sidebar's
 * expand control, `⌥⌘J`, `⌘B`, and on a phone the same two header controls — and
 * under the tab style the empty state is the HOME PAGE: a strip whose empty state
 * is the catalog is a real answer, which is why a fresh session legitimately
 * opens on `Panel kanan` with no tab. The same state is wrong for a control whose
 * promise is "bring the panel back": measured in Chromium at 1440x900 on a fresh
 * session with `rightPanelNav: tabs`, the toggle restored the card grid while the
 * Stats navbar readout — which asks for a panel by name (`omp:open-panel`) —
 * opened `Resources` as a tab. Two clicks that both say "show me the panel" gave
 * two different answers, and the second one looked broken.
 *
 * So the rule is stated once, for every column and drawer, and it is a GESTURE,
 * not a state:
 *
 * - **Only a reveal counts.** Keying it on "the panel is open and on its home
 *   page" would fight the `+` control: pressing it to browse the catalog would be
 *   undone on the next render.
 * - **Only the home page is left.** A panel already showing a tab has nothing to
 *   open — revealing it is enough.
 * - **A view the panel cannot draw is not opened.** The stored selection can name
 *   a panel that is switched off, uninstalled, or whose bundle has not loaded;
 *   `open` would write an id `visiblePanelTabs` filters straight back out, which
 *   is a write loop disguised as a sync.
 * - **A column that mounts open reveals nothing.** A restored selection is not a
 *   request (`useRightOpenRequest` owns that), and a fresh tab-style install must
 *   not open `Files` by itself. A phone DRAWER is the other case: it mounts on
 *   the very gesture that opens it, so it passes that gesture explicitly instead
 *   of relying on the mount (`useRevealSignal`).
 *
 * Deliberately NOT in `toggleRightSide` / the phone's screen state: those own
 * visibility and know nothing about how a panel navigates itself, and the same
 * reveal arrives from a chord, the palette and a header control.
 */

import { useEffect, useRef } from 'preact/hooks';

export interface RevealTabInput {
  /** A reveal gesture landed on this render. */
  revealed: boolean;
  /** The strip is showing the catalog instead of a view. */
  home: boolean;
  /** The view the panel would show — its stored selection. */
  view: string;
  /** Every id this panel could draw right now. */
  known: ReadonlySet<string>;
  /** Only the tab style has a home page to leave. */
  enabled: boolean;
}

/** The id a reveal must open, or `null` when there is nothing to do. */
export function revealTabId({ revealed, home, view, known, enabled }: RevealTabInput): string | null {
  if (!enabled || !revealed) return null;
  if (!home) return null;
  if (!view || !known.has(view)) return null;
  return view;
}

/**
 * The closed → open edge of a desktop panel column.
 *
 * Seeded with the CURRENT value: a column that mounts open is not a reveal, which
 * is what keeps a fresh tab-style install off `Files`.
 */
export function useRevealEdge(open: boolean): boolean {
  const wasOpen = useRef(open);
  const revealed = open && !wasOpen.current;
  // Written in an EFFECT, not during render: `revealed` is already derived from
  // the previous value above, and a render-time write is a side effect the next
  // commit could observe out of order.
  useEffect(() => {
    wasOpen.current = open;
  }, [open]);
  return revealed;
}

/**
 * A reveal asked for by name — a phone drawer's own open gesture.
 *
 * A drawer unmounts when it closes, so its mount IS the open, and it can mount
 * AFTER the header bumped its counter — which is why the baseline is `0` rather
 * than the value at mount: a drawer that mounts with a non-zero counter was
 * asked for by the control that bumped it. The layout resets the counter when
 * the drawer closes, so opening it another way (a plugin readout, a screen
 * change) mounts with `0` and lands on the catalog as before.
 *
 * The same hook serves the LEFT drawer, which stays mounted: there the counter
 * moves while the hook is alive, and the comparison is an ordinary edge.
 */
export function useRevealSignal(signal: number): boolean {
  const seen = useRef(0);
  // `0` is the layout's own "nothing asked for a reveal" — a named open clears
  // the counter, and a drawer mounting on that clear must not read the drop from
  // a previous press as a fresh gesture.
  const revealed = signal !== 0 && signal !== seen.current;
  // Written in an EFFECT, like `useRevealEdge`: the value above is this render's
  // answer, and moving the baseline during render is a side effect the next
  // commit could observe out of order.
  useEffect(() => {
    seen.current = signal;
  }, [signal]);
  return revealed;
}

export interface RevealPanelTabOptions {
  /** Whether this panel navigates by a strip at all. */
  enabled: boolean;
  /** A reveal gesture landed on this render — see `useRevealEdge`. */
  revealed: boolean;
  /** The view to show when the strip has nothing on screen. */
  view: string;
  /** The panel's strip is showing its catalog. */
  home: boolean;
  /**
   * The strip's own `open`, so the reveal writes what a card would.
   *
   * `null` for a panel that has no strip right now (a phone drawer with the rail
   * off owns no working set): the caller must still call this hook, because a
   * hook cannot be conditional, and a `null` writer is how it says "nothing to
   * open here" without a second flag to keep in sync.
   */
  openTab: ((id: string) => void) | null;
  /** Every id this panel could draw right now. */
  known: ReadonlySet<string>;
}

/**
 * Leave the home page when the panel is revealed.
 *
 * Called unconditionally by every panel (hooks cannot be conditional); the
 * `enabled` flag is what keeps rail panels out of it, where there is no home page
 * and the stored selection is already on screen.
 */
export function useRevealPanelTab({ enabled, revealed, view, home, openTab, known }: RevealPanelTabOptions): void {
  useEffect(() => {
    if (!openTab) return;
    const id = revealTabId({ revealed, home, view, known, enabled });
    if (id !== null) openTab(id);
  }, [enabled, revealed, home, view, known, openTab]);
}
