import { useCallback, useEffect, useMemo, useRef } from 'preact/hooks';
import { usePanelCatalog, type PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import { useSharedSessionState } from '@/client/hooks/workspace/session-state';
import { useSessionStateContext } from '@/client/hooks/workspace/session-state/context';
import { getSessionValue } from '@/shared/lib/workspace/session-state/store';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { phoneRightPanels } from '@/shared/lib/workspace/mobile-dock';
import { DEFAULT_RIGHT_PANEL_TYPE } from '@/shared/lib/workspace/right-panels';
import {
  armTerminalSoftKeyboard,
  panelWantsSoftKeyboard,
} from '@/client/components/workspace/terminal-panel/soft-keyboard';
import { releaseSoftKeyboard } from '@/client/lib/ui/soft-keyboard';
import { PanelTabsColumn } from '@/client/components/workspace/panel-tabs';
import { DrawerBody, DrawerHeader } from '@/client/components/mobile/mobile-right-sidebar/Chrome';
import { DrawerCloseAction, drawerStripProps } from '@/client/components/mobile/drawer-strip';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import { useRevealPanelTab, useRevealSignal } from '@/client/hooks/workspace/panel-tabs-reveal';
import { useMobilePanelNav } from '@/client/hooks/workspace/mobile-panel-nav';
import { VisibilityMenu } from '@/client/components/layout/VisibilityMenu';
import { usePanelVisibilityMenu } from '@/client/hooks/workspace/panel-visibility-menu';

interface MobileRightSidebarProps {
  enabled?: boolean;
  rootPath?: string;
  /** Bumped after a write so the explorer, git and context panels re-read. */
  refreshKey?: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  onClose: () => void;
  /**
   * A header control asked for this drawer. The drawer unmounts when it closes,
   * so its mount is also what a screen change for any other reason produces —
   * this counter is the only thing that can say "a reveal gesture landed", which
   * is what makes it show a VIEW instead of its catalog (`panel-tabs-reveal`).
   */
  revealSignal?: number;
}

/**
 * The phone's right-side drawer.
 *
 * Same views, same order and same titles as the desktop activity bar: the
 * catalog and the meta table are shared, so the two layouts cannot list the
 * views differently. Visibility is shared too — a view hidden from the desktop
 * bar is hidden here, because that choice is about Kabmo, not about one
 * layout — and a hidden view keeps its row in the desktop right-click menu,
 * which is where it is switched back on.
 */
export function MobileRightSidebar({
  enabled = true,
  rootPath,
  refreshKey = 0,
  onRefresh,
  onOpenFile,
  onClose,
  revealSignal = 0
}: MobileRightSidebarProps) {
  // The tab is persisted, and that is a performance decision as much as a
  // convenience one: the drawer UNMOUNTS when it closes, so whichever view is
  // selected is the one that mounts and runs its own fetch next time. Coming
  // back on the Search view re-ran a query that can hold thousands of hits, and
  // the user never asked for a search. Restoring the tab they left also keeps
  // the phone and the desktop on the same view.
  const [activeTab, setActiveTab] = useSharedSessionState<string>('layout.mobileRightPanel', DEFAULT_RIGHT_PANEL_TYPE);
  const { sessionId } = useSessionStateContext();
  // ONE catalog, the same one the desktop bars read, and deliberately `all`:
  // a phone has ONE drawer, so a plugin panel the user placed on the left must
  // stay reachable here — reading only the right column would make placing a
  // panel on the left hide it from every phone. The dock's own session list is
  // filtered out below: the phone already has that as its own drawer screen,
  // and a second copy inside this one would be two lists of the same sessions.
  //
  // The exception is the one case where the LEFT drawer can now reach them
  // itself: with the rail on, a placed panel gets a chip there, and listing it
  // here as well would put one panel on two strips of one phone.
  const dock = useLeftDock();
  const catalog = phoneRightPanels(usePanelCatalog('all'), SESSIONS_VIEW_ID, dock.enabled);
  // A stored tab can name a panel the user has since placed on the LEFT rail.
  // It is gone from this catalog, and saying "No session selected" over a
  // drawer that has views would be a wrong answer — the first view is drawn
  // instead, and the stored id is replaced on the next click.
  const activePanel = catalog.find((panel) => panel.id === activeTab) ?? catalog[0];

  /**
   * The chrome the drawer navigates with.
   *
   * `classic` is the strip of the whole catalog this drawer always had. `tabs`
   * is the desktop's WORKING SET on a phone: the strip holds only opened views
   * and a home page lists the rest, so a drawer that used to open on eleven
   * chips opens on what the user was actually using. The set is the SAME key the
   * desktop right column writes (`layout.rightPanelTabs`) — one working set
   * across the layouts, which is why switching device does not lose the tabs.
   */
  const navStyle = useMobilePanelNav('right');
  const tabsMode = navStyle === 'tabs';
  const known = useMemo(() => new Set(catalog.map((panel) => panel.id)), [catalog]);
  const tabsState = usePanelTabs('right', known, null);
  // The header's "Open Right Panel" is a reveal, so it must show a VIEW rather
  // than the catalog — the same rule the desktop column follows, and the same
  // one the Stats readout already satisfies by naming a panel.
  useRevealPanelTab({
    enabled: tabsMode,
    revealed: useRevealSignal(revealSignal),
    view: activeTab,
    home: tabsState.home,
    chosenHome: tabsState.chosenHome,
    openTab: tabsState.open,
    known,
  });
  const { open: openTab, tabs: openTabIds } = tabsState;
  // Whether the session's blob actually holds a right-drawer view. Read through
  // the store (not the hook's fallback), because "unset" and "set to the
  // default" are different facts here.
  const hasStoredTab = getSessionValue<string>(sessionId, 'layout.mobileRightPanel') !== undefined;

  /**
   * Every gesture that CHANGES the view must arm the soft keyboard before the
   * terminal mounts (`soft-keyboard.ts`); the tap that opened the drawer arms it
   * optimistically and the drawer releases it when another view lands. A card
   * and a chip are both such a gesture, so both go through here rather than
   * straight to the hook.
   */
  const arm = (id: string) => {
    if (id !== activePanel?.id) armTerminalSoftKeyboard(id);
  };

  /**
   * A tab change the DRAWER itself made — a chip, a card, a close — as opposed
   * to one that arrived from outside.
   *
   * `layout.mobileRightPanel` is BOTH the mirror of the strip's selection and
   * the slot an outside caller writes to ask for a view (`omp:open-panel`, the
   * layout's own handler). The seed effect below cannot tell "the user just
   * closed this tab" from "something asked for this view": a close writes
   * `active` to the neighbour while `activeTab` is still one render behind, so
   * the seed re-opened the tab that had just been closed — and an open did the
   * same to the view the user was leaving. That is the reported "the active
   * panel will not close, and the previous one comes back with the next one".
   *
   * The flag marks the commit that follows a gesture from here; the seed effect
   * consumes it and skips exactly that one. A mount and an outside request
   * never set it, so both still seed.
   */
  const ownGesture = useRef(false);
  const tabHandle = {
    ...tabsState,
    select: (id: string) => {
      ownGesture.current = true;
      arm(id);
      tabsState.select(id);
    },
    open: (id: string) => {
      ownGesture.current = true;
      arm(id);
      tabsState.open(id);
    },
    close: (id: string) => {
      ownGesture.current = true;
      tabsState.close(id);
    },
  };
  // The drawer is a SCREEN, so only the active view may be mounted and a delete
  // of the whole set must not leave the last one behind it. `activeTab` stays
  // the stored mirror: the layout's `omp:open-panel` writes it and the keyboard
  // arming reads it.
  useEffect(() => {
    if (!tabsMode) return;
    if (tabsState.active !== null && tabsState.active !== activeTab) setActiveTab(tabsState.active);
  }, [tabsMode, tabsState.active, activeTab, setActiveTab]);
  useEffect(() => {
    if (!tabsMode || tabsState.home) return;
    // A commit the drawer made ITSELF (a chip, a card, a close) is already the
    // answer, not a request: re-seeding it would reopen the tab that was just
    // closed, or the view the user is leaving. Only a commit that came from
    // outside (the drawer mounting, `omp:open-panel` writing the key while the
    // drawer is closed) seeds.
    if (ownGesture.current) {
      ownGesture.current = false;
      return;
    }
    // A RESTORED selection is not a request, the same rule the desktop column
    // follows: `layout.mobileRightPanel` falls back to `files`, so seeding from
    // it unconditionally opened a Files tab on every fresh chat and the home
    // page never appeared. Only a value the SESSION actually stores is adopted;
    // a fresh drawer starts on its catalog.
    if (!hasStoredTab) return;
    // Only a view this drawer can DRAW becomes a tab; an id the catalog dropped
    // (a panel moved to the left rail, a plugin unloaded) would be filtered
    // straight back out and re-opened on the next render.
    if (openTabIds.includes(activeTab) || !known.has(activeTab)) return;
    openTab(activeTab);
  }, [tabsMode, tabsState.home, hasStoredTab, activeTab, openTabIds, openTab, known]);
  // Same source the desktop activity bar uses — the Source Control view's own
  // repo pick, read shared so switching repos moves this dot too. Polls only
  // while this drawer is the mounted screen (the poll is visibility-gated).
  const activeRepo = useResolvedRepo(rootPath, enabled);
  const { changes } = useGitStatus(rootPath, activeRepo, enabled);
  const hasGitChanges = changes.length > 0;

  // A tap on a chip is the gesture that can open the soft keyboard, and the
  // terminal's view mounts after it — so the keyboard is armed here, before the
  // panel exists (`soft-keyboard.ts`). Tapping the chip that is already active
  // must not arm it: the terminal is mounted and focused, and the bridge would
  // take the keyboard away from it.
  const handleSelectTab = useCallback((id: string) => {
    if (id !== activePanel?.id) armTerminalSoftKeyboard(id);
    setActiveTab(id);
  }, [activePanel?.id, setActiveTab]);

  // The drawer can open on a stored tab that is no longer the terminal (the
  // view was disabled, moved to the left rail, or the session has no
  // workspace). The tap that opened the drawer armed the keyboard optimistically;
  // drop it when the view that actually mounted is not the one that types.
  useEffect(() => {
    if (!panelWantsSoftKeyboard(activePanel?.id)) releaseSoftKeyboard();
  }, [activePanel?.id]);

  // The phone's right-click: a long press on the drawer's header opens the same
  // panel switch the desktop right rail has. The list follows the drawer's own
  // rule — with the left rail on, a panel placed there is not in this drawer,
  // so it is not offered here either; with the rail off this drawer is the
  // catch-all and lists everything but the session list.
  const panelMenu = usePanelVisibilityMenu(dock.enabled ? 'right' : 'all');
  const menuItems = dock.enabled
    ? panelMenu.items
    : panelMenu.items.filter((item) => item.id !== SESSIONS_VIEW_ID);

  // ONE props object per render, handed to the view AND published on the host
  // context, so a component nested inside the view reads exactly what its
  // top-level one was given.
  const mobileBody: PanelBodyProps = {
    className: 'h-full w-full',
    enabled: enabled || !activePanel?.requiresWorkspace,
    active: true,
    refreshKey,
    ...(rootPath ? { rootPath } : {}),
    onRefresh,
    onOpenFile,
    onClose,
    // The drawer draws its own tab bar, so a view's own header would be a second one.
    showHeader: false,
    layout: 'phone',
  };

  /**
   * The drawer's chrome, and the reason there are two shapes of it.
   *
   * `classic` has a HEADER because the header IS its navigation: the chip strip
   * lives in it, so it must be tall enough to hold a 44px touch target and it
   * has to say what the drawer is. `tabs` has no header at all — the strip above
   * the body already names the view on every chip, and a second row stating
   * "Panel" plus a close button cost 56px of a phone screen to repeat what the
   * strip says. That is also what the desktop column does: under `tabs` the
   * strip is the whole chrome.
   *
   * Two things the header carried survive its removal under `tabs`: the WINDOW
   * contract (`data-drag-region`, the shell's traffic-light inset, the safe-area
   * top) and the close control, which moves into the strip's trailing actions.
   */
  return (
    <div className="flex flex-col h-full w-full bg-paper text-ink relative select-none">
      {tabsMode ? null : (
        <DrawerHeader
          catalog={catalog}
          activeId={activePanel?.id ?? activeTab}
          onSelect={handleSelectTab}
          hasGitChanges={hasGitChanges}
          onClose={onClose}
          menuProps={panelMenu.surfaceProps}
        />
      )}

      {tabsMode ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <PanelTabsColumn
            catalog={catalog}
            tabs={tabHandle}
            homeTitle="Panel kanan"
            stripProps={drawerStripProps(panelMenu.surfaceProps)}
            actions={<DrawerCloseAction side="right" onClose={onClose} />}
          >
            <div className="h-full w-full">
              <DrawerBody panel={activePanel} body={mobileBody} />
            </div>
          </PanelTabsColumn>
        </div>
      ) : null}

      {panelMenu.anchor ? (
        <VisibilityMenu
          anchor={panelMenu.anchor}
          align="right"
          items={menuItems}
          hidden={panelMenu.hidden}
          onToggle={panelMenu.toggle}
          onClose={panelMenu.close}
        />
      ) : null}

      {/* Main Tab Content — the same catalog entries the desktop stack draws,
          through the same `render`, so the two layouts cannot hand a view
          different props. The workspace gate applies per VIEW, not to the whole
          drawer: a todo list and a plan both belong to the SESSION, not to the
          folder its cwd resolves to, so those stay reachable for a session
          running outside every registered workspace. */}
      {/* Under `tabs` the strip and the home page are the drawer's chrome, so the
          body lives inside `PanelTabsColumn`; under `classic` the chip strip in
          the header is that chrome and the body is the whole remaining screen. */}
      {tabsMode ? null : (
        <div
          className="flex-1 min-h-0 overflow-hidden relative"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          <DrawerBody panel={activePanel} body={mobileBody} />
        </div>
      )}

    </div>
  );
}
