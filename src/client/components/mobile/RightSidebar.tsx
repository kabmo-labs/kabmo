import { Suspense } from 'preact/compat';
import { useCallback, useEffect, useMemo } from 'preact/hooks';
import { X } from 'lucide-preact';
import { usePanelCatalog, type PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
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
import { PanelChips } from '@/client/components/mobile/panel-chips';
import { PanelTabsColumn } from '@/client/components/workspace/panel-tabs';
import { usePanelTabs } from '@/client/hooks/workspace/panel-tabs';
import { useMobileRightPanelNav } from '@/client/hooks/workspace/mobile-right-panel-nav';
import { VisibilityMenu } from '@/client/components/layout/VisibilityMenu';
import { usePanelVisibilityMenu } from '@/client/hooks/workspace/panel-visibility-menu';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';
import { dragRegionProps, titlebarInsetLeft } from '@/client/lib/desktop/titlebar';

interface MobileRightSidebarProps {
  enabled?: boolean;
  rootPath?: string;
  /** Bumped after a write so the explorer, git and context panels re-read. */
  refreshKey?: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
  onClose: () => void;
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
  onClose
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
  const navStyle = useMobileRightPanelNav();
  const tabsMode = navStyle === 'tabs';
  const known = useMemo(() => new Set(catalog.map((panel) => panel.id)), [catalog]);
  const tabsState = usePanelTabs('right', known, null);
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
  const tabHandle = {
    ...tabsState,
    select: (id: string) => {
      arm(id);
      tabsState.select(id);
    },
    open: (id: string) => {
      arm(id);
      tabsState.open(id);
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
   * The active view's body, and the "nothing selected" sentence.
   *
   * A plugin component renders in the host's tree like any other view, so it
   * needs no workspace folder and no session: it reads whatever the host
   * published and draws what it can. Gating it here would hide a panel that
   * works.
   */
  const renderActiveBody = () => (activePanel ? (
    <Suspense fallback={<div className="h-full flex items-center justify-center text-ink/40"><span className="text-xs font-mono">Loading…</span></div>}>
      <PanelHostProvider value={mobileBody}>{activePanel.render(mobileBody)}</PanelHostProvider>
    </Suspense>
  ) : (
    <div className="h-full flex items-center justify-center text-ink/40">
      <span className="text-xs font-mono text-muted">No session selected</span>
    </div>
  ));

  return (
    <div className="flex flex-col h-full w-full bg-paper text-ink relative select-none">

      {/* Top Header & Tab Navigation Bar. It is the window's title bar while
          this drawer is the mounted screen: a desktop shell window narrowed
          past the layout breakpoint shows it, and without `data-drag-region`
          there is nothing left to move the window by. The chip strip inside is
          the `titlebar-no-drag` cluster. */}
      <div
        className="border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0 bg-canvas titlebar-drag-region select-none"
        {...dragRegionProps()}
        {...panelMenu.surfaceProps}
        style={{
          height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: titlebarInsetLeft(titlebarPaddingLeft('0.75rem', true)),
          paddingRight: titlebarPaddingRight('0.75rem', true),
        }}
      >

        {/* The header is now a drag region, so its controls must say so —
            `app-region` inherits, and a control inside a drag region is a drag
            handle that swallows its own click on Windows. */}
        <div className="flex items-center min-w-0 titlebar-no-drag">
          {tabsMode ? (
            // The header keeps its height and its close button; the strip is a
            // second row, because a phone's title row cannot hold eleven chips
            // and a close target at once.
            <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-ink/60 font-mono">
              Panel
            </span>
          ) : (
            <PanelChips
              panels={catalog}
              activeId={activePanel?.id ?? activeTab}
              onSelect={handleSelectTab}
              hasGitChanges={hasGitChanges}
            />
          )}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink transition-colors flex-shrink-0 ml-2 titlebar-no-drag"
          title="Close right sidebar"
          aria-label="Close right sidebar"
        >
          <X size={20} strokeWidth={1.8} />
        </button>
      </div>

      {tabsMode ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <PanelTabsColumn catalog={catalog} tabs={tabHandle} homeTitle="Panel kanan">
            <div className="h-full w-full">
              {renderActiveBody()}
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
          different props. The workspace gate below applies per VIEW, not to the
          whole drawer: a todo list and a plan both belong to the SESSION, not to
          the folder its cwd resolves to, so those stay reachable for a session
          running outside every registered workspace. */}
      {/* Under `tabs` the strip and the home page are the drawer's chrome, so the
          body lives inside `PanelTabsColumn`; under `classic` the chip strip in
          the header is that chrome and the body is the whole remaining screen. */}
      {tabsMode ? null : (
        <div
          className="flex-1 min-h-0 overflow-hidden relative"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {renderActiveBody()}
        </div>
      )}

    </div>
  );
}
