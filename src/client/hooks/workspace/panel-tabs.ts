/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A desktop panel column's open-tab state, per session.
 *
 * Per SESSION, not global: the working set is what the user is doing in THIS
 * chat — the files they are reading, the terminal they left running — so
 * switching chats must not carry another chat's tabs into this one. The
 * placement and the navigation STYLE stay global (`omp_left_panels`,
 * `leftPanelNav`/`rightPanelNav`), because those describe the person's
 * arrangement rather than one conversation's work.
 *
 * **`home` is a state of its own, not `active === null`.** The left column pins
 * the session list, so that column always HAS a view to show; if the home page
 * were spelled by "nothing selected" it could never open, and if it were spelled
 * by "the pinned tab is not selected" the pinned view would be a tab the user
 * cannot look at. One boolean says the catalog is on screen, and the selection
 * survives behind it.
 *
 * ONE stored value, not two: two keys would let a close write the list before
 * the selection landed and leave the column resolving an id that is no longer in
 * it.
 */

import { useCallback, useMemo } from 'preact/hooks';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import {
  closePanelTab,
  nextActiveTab,
  openPanelTab,
  visiblePanelTabs,
  withPinnedTab,
  type PanelTabs,
} from '@/shared/lib/workspace/panel-tabs';
import type { PanelNavSide } from '@/shared/lib/workspace/panel-nav';

export interface PanelTabsHandle {
  /** The ids currently open, in strip order — already filtered to drawable ones. */
  tabs: PanelTabs;
  /** The tab the column shows, or `null` when nothing is open at all. */
  active: string | null;
  /** The catalog is on screen. The strip and the selection stay behind it. */
  home: boolean;
  /**
   * The home page was ASKED for — `+`, or closing the last tab — as opposed to
   * a column that has simply never held a tab.
   *
   * `home` cannot answer this: it is also true for an empty strip, which is how
   * a fresh session starts. A reveal may leave the default home page, but it
   * must never undo a close.
   */
  chosenHome: boolean;
  /** Open a view (or focus it when it is already open) and select it. */
  open: (id: string) => void;
  /** Select a tab that is already open; a no-op for an id that is not. */
  select: (id: string) => void;
  /** Close a tab. The pinned view and unknown ids are refused. */
  close: (id: string) => void;
  /**
   * Adopt a new strip order after a drag.
   *
   * The order is SESSION state like the list itself, not the column's global
   * placement: two chats may keep the same views in a different order, and a
   * drag on one chat's strip must not rearrange another's. The pinned view is
   * put back in front by `withPinnedTab`, so a drop can never move the column's
   * own view out of first place.
   */
  setOrder: (ids: readonly string[]) => void;
  /** Show the catalog without closing anything. */
  showHome: () => void;
}

interface ColumnTabs {
  tabs: PanelTabs;
  active: string | null;
  home: boolean;
}

/**
 * A session that has never opened a tab: an EMPTY strip on the HOME PAGE.
 *
 * This is the default for every new chat, and it is what makes the tab style
 * differ from the rail's default (which opens `Files`). A rail has to show
 * something — a column with no view is a column of buttons over nothing — while
 * a strip's empty state is its catalog, which is a real answer. So the stored
 * `layout.activeRightPanel` (`files`) does NOT seed a tab by itself: only an
 * explicit request (`useRightOpenRequest`), or a reveal of a session that had
 * already picked a view (`panel-tabs-reveal`), opens one.
 */
const EMPTY: ColumnTabs = { tabs: [], active: null, home: false };

/** A stored value from another build, a corrupted blob, or nothing at all. */
function readStored(value: unknown): ColumnTabs {
  if (typeof value !== 'object' || value === null) return EMPTY;
  const raw = value as { tabs?: unknown; active?: unknown; home?: unknown };
  const tabs = Array.isArray(raw.tabs)
    ? raw.tabs.filter((id): id is string => typeof id === 'string')
    : [];
  // `home` survives an EMPTY strip, and it must: closing the last tab writes
  // `{ tabs: [], home: true }`, and collapsing that to `EMPTY` (which spells
  // `home: false`) erased the one fact that says the user CHOSE the catalog.
  // The reveal rule then read it as a fresh session and reopened the tab they
  // had just closed. An empty list is not a corrupt blob; only a non-object is.
  const active = typeof raw.active === 'string' ? raw.active : null;
  return { tabs, active, home: raw.home === true };
}

/**
 * One column's tabs.
 *
 * `known` is every id the column could draw right now (the catalog's ids). A
 * stored id that is no longer in it — a disabled panel, an uninstalled plugin, a
 * bundle mid-import — is dropped on sight rather than left to render an empty
 * body, and a column whose whole set vanished lands on its home page.
 */
export function usePanelTabs(
  side: PanelNavSide,
  known: ReadonlySet<string>,
  pinned: string | null,
): PanelTabsHandle {
  // `layout.*` like every other layout slot (`layout.openedFiles`,
  // `layout.showRightPanel`, `layout.showLeftPanel`): the prefix is what tells
  // a reader of the stored blob that this is per-session UI, not a setting, and
  // a key without it was the one thing this hook did differently.
  const [storedValue, setStored] = useSessionState<unknown>(`layout.${side}PanelTabs`, EMPTY);

  const stored = useMemo(() => readStored(storedValue), [storedValue]);

  const tabs = useMemo(() => {
    const visible = visiblePanelTabs(stored.tabs, known);
    return pinned === null ? visible : withPinnedTab(visible, pinned);
  }, [stored.tabs, known, pinned]);

  // The selection is DERIVED, not stored blindly: a stored id that was closed,
  // disabled or never drawable resolves through the same rule a close uses, so a
  // panel switched off while its tab was open lands on a neighbour rather than
  // on a blank body. A pinned view is what a column with no choice shows.
  const active = useMemo(() => {
    if (tabs.length === 0) return null;
    if (stored.active !== null && tabs.includes(stored.active)) return stored.active;
    return tabs[0] ?? null;
  }, [stored.active, tabs]);

  // The home page needs something to go back to. A column that lost every tab
  // (all switched off) shows the catalog instead of a blank body, and so does a
  // pinned column that was closed down to its pinned tab only if the user asked
  // for it — which is the stored `home` flag, not a consequence.
  const home = stored.home || tabs.length === 0;
  // The stored flag, WITHOUT the empty-strip fallback: a reveal must be able to
  // tell "the user closed the last tab" (keep the catalog) from "this session
  // has never opened one" (leaving the catalog for a view is the toggle's job).
  const chosenHome = stored.home;

  const write = useCallback((next: ColumnTabs) => setStored(next), [setStored]);

  const open = useCallback(
    (id: string) => {
      // Idempotent, and that is load-bearing rather than tidy: callers open a
      // view from an EFFECT (`omp:open-panel`, a restored selection), and a
      // write with the same content still produces a new object — which
      // re-renders the column, re-runs the effect and writes again. The guard is
      // what makes "open" safe to call from a render-driven path at all.
      if (tabs.includes(id) && active === id && !home) return;
      const opened = openPanelTab(tabs, id);
      write({ tabs: pinned === null ? opened : withPinnedTab(opened, pinned), active: id, home: false });
    },
    [tabs, active, home, pinned, write],
  );

  const select = useCallback(
    (id: string) => {
      if (!tabs.includes(id)) return;
      write({ tabs, active: id, home: false });
    },
    [tabs, write],
  );

  const close = useCallback(
    (id: string) => {
      const next = closePanelTab(tabs, id, pinned ?? undefined);
      if (next === tabs) return;
      // `nextActiveTab` owns the neighbour rule, so a close never leaves a stored
      // id pointing at a closed tab; an empty list is the home page.
      write({ tabs: next, active: nextActiveTab(tabs, next, active), home: next.length === 0 });
    },
    [tabs, active, pinned, write],
  );

  const showHome = useCallback(() => write({ tabs, active, home: true }), [tabs, active, write]);

  const setOrder = useCallback(
    (ids: readonly string[]) => {
      // The dropped list must be a PERMUTATION of the open set. A length check
      // is not enough: `['files','files']` has the right length for
      // `['files','git']` and would silently drop `git` while duplicating a chip.
      // A view closed mid-gesture (another window, a plugin that unloaded) makes
      // the drop not the user's arrangement, so it is refused outright.
      if (ids.length !== tabs.length) return;
      const open = new Set(tabs);
      const next = ids.filter((id) => open.has(id));
      if (next.length !== tabs.length || new Set(next).size !== tabs.length) return;
      const ordered = pinned === null ? next : withPinnedTab(next, pinned);
      write({ tabs: ordered, active, home });
    },
    [tabs, active, home, pinned, write],
  );

  return { tabs, active, home, chosenHome, open, select, close, setOrder, showHome };
}
