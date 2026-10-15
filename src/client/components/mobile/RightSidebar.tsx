import { Suspense } from 'preact/compat';
import { X } from 'lucide-preact';
import { usePanelCatalog, type PanelBodyProps } from '@/client/components/workspace/plugin-panel/resolve';
import { PanelHostProvider } from '@ompchamber/ui';
import { useGitStatus } from '@/client/hooks/workspace/git-status';
import { useResolvedRepo } from '@/client/hooks/workspace/repo-scope';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { PluginMark } from '@/client/components/settings/categories/panel-plugins/PluginMark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';

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
 * bar is hidden here, because that choice is about the CHAMBER, not about one
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
  // ONE catalog, the same one the desktop bar reads: the built-in views and the
  // installed plugins are one list, in one order, so the phone cannot become a
  // second list that drifts from the desktop's. A view switched off is absent
  // here for the same reason it is absent there.
  const catalog = usePanelCatalog();
  const activePanel = catalog.find((panel) => panel.id === activeTab);
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

        <div className="flex items-center space-x-1.5 overflow-x-auto no-scrollbar py-1">
          {catalog.map((panel) => (
            <button
              key={panel.id}
              type="button"
              onClick={() => setActiveTab(panel.id)}
              className={`relative flex items-center transition-all cursor-pointer ${
                activeTab === panel.id
                  ? 'space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-ink text-canvas shadow-sm'
                  : 'p-2 rounded-lg text-ink/70 hover:bg-ink/5'
              }`}
              title={panel.title}
            >
              {panel.builtin ? panel.icon : <PluginMark name={panel.name} iconUrl={panel.iconUrl} size={PANEL_MARK_SIZE} />}
              {activeTab === panel.id && (
                <span className={panel.id === 'git' ? 'tracking-wide' : undefined}>{panel.label}</span>
              )}
              {panel.id === 'git' && hasGitChanges && (
                <span
                  className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-info"
                  title="Uncommitted changes"
                />
              )}
            </button>
          ))}
        </div>

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
