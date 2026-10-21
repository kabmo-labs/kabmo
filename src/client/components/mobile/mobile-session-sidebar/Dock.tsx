/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's LEFT dock: the chip strip and the body of a placed panel.
 *
 * The desktop's left column is a dock — the session list plus whatever plugin
 * the user placed beside it, switched by a vertical rail. A phone has no room
 * for a rail, so the rail is the same horizontal chip strip the right drawer
 * uses (`panel-chips.tsx`), and the body is the same `panel.render`.
 *
 * The session list is NOT rendered here: the phone's list is its own component
 * (`MobileSessionList`), unlike the desktop's `SessionsView`, so the caller
 * keeps drawing it and only hands over the OTHER views. That is also why the
 * strip is drawn only while it has something else to switch to.
 */

import { Suspense } from 'preact/compat';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PluginPanelBody } from '@/client/components/workspace/plugin-panel/resolve';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { PanelChips } from '@/client/components/mobile/panel-chips';

/** The strip row, drawn under the drawer's title. */
export function MobileDockStrip({
  panels,
  activeId,
  onSelect,
}: {
  panels: readonly ResolvedPanel[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="px-3 py-1.5 border-b border-ink/10 bg-canvas flex-shrink-0">
      <PanelChips panels={panels} activeId={activeId} onSelect={onSelect} />
    </div>
  );
}

/**
 * The body of one placed panel.
 *
 * A selection naming a panel that is switched off, uninstalled or still loading
 * has no entry — `PluginPanelBody` says which, rather than leaving the drawer
 * blank. That is the same notice the desktop dock draws.
 */
export function MobileDockBody({
  panelKey,
  panel,
  body,
}: {
  panelKey: string;
  panel?: ResolvedPanel;
  body: PanelBodyProps;
}) {
  if (!panel) {
    return (
      <div className="flex-1 min-h-0">
        <PluginPanelBody panelKey={panelKey} />
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-hidden relative">
      <Suspense
        fallback={
          <div className="h-full flex items-center justify-center text-ink/40">
            <span className="text-xs font-mono">Loading…</span>
          </div>
        }
      >
        <PanelHostProvider value={body}>{panel.render(body)}</PanelHostProvider>
      </Suspense>
    </div>
  );
}
