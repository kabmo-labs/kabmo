import { Suspense } from 'preact/compat';
import { X } from 'lucide-preact';
import { usePanelCatalog, type PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useLeftDock } from '@/client/hooks/workspace/left-dock';
import { SESSIONS_VIEW_ID } from '@/shared/lib/workspace/left-dock';
import { phoneRightPanels } from '@/shared/lib/workspace/mobile-dock';
import { PanelChips } from '@/client/components/mobile/panel-chips';

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
  const [activeTab, setActiveTab] = useSessionState<string>('layout.mobileRightPanel', 'files');
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
  // Same source the desktop activity bar uses — the Source Control view's own
  // repo pick, read shared so switching repos moves this dot too. Polls only
  // while this drawer is the mounted screen (the poll is visibility-gated).
  const activeRepo = useResolvedRepo(rootPath, enabled);
  const { changes } = useGitStatus(rootPath, activeRepo, enabled);
  const hasGitChanges = changes.length > 0;

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
  };

  return (
    <div className="flex flex-col h-full w-full bg-paper text-ink relative select-none">

      {/* Top Header & Tab Navigation Bar */}
      <div
        className="border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0 bg-canvas"
        style={{
          height: 'calc(3.5rem + env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
          paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
        }}
      >

        <PanelChips
          panels={catalog}
          activeId={activePanel?.id ?? activeTab}
          onSelect={setActiveTab}
          hasGitChanges={hasGitChanges}
        />

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink transition-colors flex-shrink-0 ml-2"
          title="Close right sidebar"
          aria-label="Close right sidebar"
        >
          <X size={20} strokeWidth={1.8} />
        </button>
      </div>

      {/* Main Tab Content — the same catalog entries the desktop stack draws,
          through the same `render`, so the two layouts cannot hand a view
          different props. The workspace gate below applies per VIEW, not to the
          whole drawer: a todo list and a plan both belong to the SESSION, not to
          the folder its cwd resolves to, so those stay reachable for a session
          running outside every registered workspace. */}
      <div
        className="flex-1 min-h-0 overflow-hidden relative"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {activePanel ? (
          // A plugin component renders in the host's tree like any other view,
          // so it needs no workspace folder and no session: it reads whatever
          // the host published and draws what it can. Gating it here would hide
          // a panel that works.
          <Suspense fallback={<div className="h-full flex items-center justify-center text-ink/40"><span className="text-xs font-mono">Loading…</span></div>}>
            <PanelHostProvider value={mobileBody}>{activePanel.render(mobileBody)}</PanelHostProvider>
          </Suspense>
        ) : (
          <div className="h-full flex items-center justify-center text-ink/40">
            <span className="text-xs font-mono">No session selected</span>
          </div>
        )}
      </div>

    </div>
  );
}
