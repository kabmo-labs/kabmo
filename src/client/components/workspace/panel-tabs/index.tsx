/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A browser-style panel column: the strip, the home page, and the view it holds.
 *
 * ONE component for both columns: the left and the right draw the same strip
 * over the same kind of body stack, and the only per-side facts are data (the
 * catalog, the pinned view, whether the column is open). Writing it twice is how
 * the two rails drifted apart before they were merged into one `ActivityBar`.
 *
 * The home page is a PAGE, not a dialog, and that is the load-bearing decision:
 *
 * - a column with nothing open is showing something — its catalog — instead of
 *   a blank body or an implicit view the user never picked;
 * - the add control and "close the last tab" land on the same surface, so there
 *   is one place the catalog is drawn and one rule for what a click means;
 * - nothing has to be portalled. The AGENTS.md rule about `fixed` overlays and
 *   the composer's containing block exists because a dialog inside the composer
 *   card is sized to the card; a page has no such failure mode.
 *
 * Tabs stay in the strip while the home page is on screen (that is what a "new
 * tab page" is), so picking a card switches back to a tab rather than appearing
 * to replace the work the user already had open.
 */

import type { ReactNode } from 'preact/compat';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import type { PanelTabsHandle } from '@/client/hooks/workspace/panel-tabs';
import { PanelTabStrip } from '@/client/components/workspace/panel-tabs/TabStrip';
import { PanelHome } from '@/client/components/workspace/panel-tabs/Home';

interface PanelTabsColumnProps {
  /** The column's whole catalog, in the order it is offered on the home page. */
  catalog: readonly ResolvedPanel[];
  /** The open tabs and their operations. */
  tabs: PanelTabsHandle;
  /** The view that cannot be closed (the left column's session list). */
  pinned?: string | null;
  /** Heading of the home page, so the empty state is about this column. */
  homeTitle: string;
  /**
   * The body. Rendered for the ACTIVE tab only — the caller keeps whichever
   * views it wants mounted and hides the rest, exactly as it does under a rail.
   */
  children: ReactNode;
  /** Column actions in the strip's trailing edge (refresh, collapse). */
  actions?: ReactNode;
}

export function PanelTabsColumn({
  catalog,
  tabs,
  pinned = null,
  homeTitle,
  children,
  actions,
}: PanelTabsColumnProps) {
  const byId = new Map(catalog.map((panel) => [panel.id, panel]));
  const openIds = new Set(tabs.tabs);
  const home = tabs.home;

  return (
    <div className="flex h-full w-full flex-col bg-paper text-ink">
      <PanelTabStrip
        tabs={tabs.tabs}
        panels={byId}
        active={tabs.active}
        pinned={pinned}
        home={home}
        onAdd={tabs.showHome}
        onSelect={tabs.select}
        onClose={tabs.close}
        onReorder={tabs.setOrder}
        {...(actions !== undefined ? { actions } : {})}
      />
      <div className="relative min-h-0 flex-1">
        <div
          // The body stays MOUNTED behind the home page: a terminal keeps its
          // PTY, a tree keeps its expansion, and the column does not re-fetch
          // every view because the user glanced at the catalog.
          className={home ? 'pointer-events-none invisible h-full w-full' : 'h-full w-full'}
          aria-hidden={home || undefined}
        >
          {children}
        </div>
        {home ? (
          <div className="absolute inset-0 bg-paper">
            <PanelHome panels={catalog} openIds={openIds} onPick={tabs.open} title={homeTitle} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
