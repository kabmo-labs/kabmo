/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The left dock's view stack: the view on screen, plus the ones kept mounted.
 *
 * The left column used to be the session sidebar and nothing else. It is a DOCK
 * now, exactly like the right column: a stack of views with one on screen.
 *
 * Two rules are load-bearing, and each is a bug if dropped:
 *
 * - **A view is never responsible for the column's furniture.** The Settings ·
 *   About strip, the update popup and the About modal belong to the COLUMN
 *   (`LeftColumn`), not to this stack: a plugin panel on the same dock must not
 *   take away the only visible way into Settings. That is also what lets the
 *   strip span the rail and the body together, which is where it belongs.
 * - **The session list stays MOUNTED while another view is on screen**, hidden
 *   with CSS, the way the right stack keeps its views: its folder expansion,
 *   scroll position and batch selection must survive a look at another view. A
 *   plugin panel is mounted only while it is the active one — a hidden plugin is
 *   a component nobody is looking at.
 */

import { Suspense } from 'preact/compat';
import type { ReactNode } from 'preact/compat';
import { PluginPanelBody } from '@/client/components/workspace/plugin-panel/resolve';
import { usePanelCatalog } from '@/client/components/workspace/plugin-panel/catalog';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { AgentStreamStatus } from '@/shared/lib/chat/omp/status';

interface LeftDockViewProps {
  className?: string;
  /** The view on screen. A stored id naming a vanished panel falls back. */
  activeView: string;
  onClose?: () => void;
  appSettings?: Record<string, any>;
  streamStatus?: AgentStreamStatus;
  refreshKey?: number;
  onRefresh?: () => void;
  onOpenFile?: (file: unknown) => void;
}

/**
 * The views are `lazy()` (the session list is its own chunk), so the stack needs
 * a boundary of its own: Preact THROWS the pending promise out of the tree when
 * a lazy child suspends with no `<Suspense>` above it, which is a blank page
 * rather than a loading state — measured with the whole app failing to mount.
 */
function DockSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-ink/40">
          <span className="text-xs font-mono">Loading…</span>
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

export function LeftDockView({
  className = '',
  activeView,
  onClose,
  appSettings = {},
  streamStatus,
  refreshKey = 0,
  onRefresh,
  onOpenFile,
}: LeftDockViewProps) {
  const catalog = usePanelCatalog('left');
  const active = catalog.find((panel) => panel.id === activeView);

  const body: PanelBodyProps = {
    className: 'w-full h-full',
    enabled: true,
    active: true,
    refreshKey,
    ...(onRefresh ? { onRefresh } : {}),
    ...(onOpenFile ? { onOpenFile } : {}),
    ...(onClose ? { onClose } : {}),
    appSettings,
    ...(streamStatus ? { streamStatus } : {}),
  };

  return (
    <DockSuspense>
      <div className={`relative h-full ${className}`}>
        {catalog.map((panel) => {
          const isActive = panel.id === activeView;
          if (!panel.builtin && !isActive) return null;
          const viewBody: PanelBodyProps = { ...body, active: isActive, enabled: isActive };
          return (
            <div key={panel.id} className={isActive ? 'w-full h-full' : 'hidden'}>
              <PanelHostProvider value={viewBody}>{panel.render(viewBody)}</PanelHostProvider>
            </div>
          );
        })}
        {/* The selection names a panel that is switched off, uninstalled, or
            whose bundle has not loaded — a notice, never a blank column. The
            session list is always drawable, so it is never this case. */}
        {!active ? (
          <div className="w-full h-full">
            <PluginPanelBody panelKey={activeView} />
          </div>
        ) : null}
      </div>
    </DockSuspense>
  );
}
