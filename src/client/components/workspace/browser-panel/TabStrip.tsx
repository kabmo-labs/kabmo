/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent browser's tab strip: which pages this session owns, which one the
 * panel is showing, and a close control per tab.
 *
 * The close button exists because omp opens a page per site it visits and never
 * tidies up. The strip is the only place a user can see them, so it is also the
 * only place they can be closed — and closing is what keeps the panel on the
 * page the user cares about, since the viewer follows the NEWEST owned tab.
 *
 * Every tab is closable, not just the active one: the fleet of stale pages is
 * the problem being solved. The close control is `group-hover` revealed except
 * on the active tab, which keeps it visible — a control that only appears on
 * hover is unreachable on a touch screen, and the active tab is the one a user
 * is most likely to want gone.
 */

import { useEffect, useRef } from 'preact/hooks';
import { X } from 'lucide-preact';
import type { BrowserTabInfo } from '@/shared/types';

interface BrowserTabStripProps {
  tabs: BrowserTabInfo[];
  targetId?: string;
  /** Tab whose close request is in flight (its button is disabled). */
  closing?: string | null;
  onSelectTarget: (targetId: string) => void;
  onCloseTarget: (targetId: string) => void;
}

/** What a tab row says: its title, else its URL, else the id as a last resort. */
function tabLabel(tab: BrowserTabInfo): string {
  return tab.title || tab.url || tab.targetId;
}

export function BrowserTabStrip({ tabs, targetId, closing, onSelectTarget, onCloseTarget }: BrowserTabStripProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  // A session that opens pages can push the active tab out of view; the strip
  // is the only map of them, so it must keep the current one visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [targetId, tabs.length]);

  return (
    <div className="px-2 py-1 border-b border-ink/10 bg-paper flex items-center gap-1 overflow-x-auto flex-shrink-0">
      {tabs.map((tab) => {
        const active = tab.targetId === targetId;
        const label = tabLabel(tab);
        return (
          <div
            key={tab.targetId}
            ref={active ? activeRef : undefined}
            className={`group flex items-center rounded border transition-colors flex-shrink-0 ${
              active
                ? 'bg-ink text-canvas border-ink'
                : 'bg-paper text-ink/70 border-ink/15 hover:border-ink/35 hover:text-ink'
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectTarget(active ? '' : tab.targetId)}
              className="pl-2 pr-1 py-0.5 text-[11px] font-mono max-w-[220px] truncate cursor-pointer"
              title={`${label}\n${tab.url}`}
              aria-pressed={active}
            >
              {label}
            </button>
            <button
              type="button"
              onClick={() => onCloseTarget(tab.targetId)}
              disabled={closing === tab.targetId}
              className={`mr-0.5 p-1 rounded hover:bg-error hover:text-paper transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                active ? 'text-on-ink-muted' : 'text-ink/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
              }`}
              aria-label={`Tutup tab ${label}`}
              title={`Tutup tab ${label}`}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
