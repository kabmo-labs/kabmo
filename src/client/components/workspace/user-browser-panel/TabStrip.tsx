/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The user browser's tab strip.
 *
 * One row of pages above the address bar, the way every browser draws it: the
 * strip is the map of what is open, the address bar describes the active tab.
 *
 * Close is revealed on hover EXCEPT on the active tab, which keeps it visible —
 * a hover-only control is unreachable on a touch screen, and the active tab is
 * the one a user most often wants gone. The `+` sits at the far right and is
 * disabled at the cap rather than hidden: a disappearing control reads as "tabs
 * are not a thing here any more".
 */

import { useEffect, useRef } from 'preact/hooks';
import { Plus, X } from 'lucide-preact';
import { MAX_USER_BROWSER_TABS, tabLabel, tabUrl, type UserBrowserTab } from '@/shared/lib/browser/user-tabs';

interface UserBrowserTabStripProps {
  tabs: UserBrowserTab[];
  activeTabId: string | null;
  canOpenTab: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onNewTab: () => void;
}

const TAB_BUTTON = 'cursor-pointer transition-colors';

export function UserBrowserTabStrip({
  tabs,
  activeTabId,
  canOpenTab,
  onSelect,
  onClose,
  onNewTab,
}: UserBrowserTabStripProps) {
  const activeRef = useRef<HTMLDivElement | null>(null);

  // A new tab can push the active one out of a narrow strip; the strip is the
  // only map of the pages, so the current one stays visible.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeTabId, tabs.length]);

  return (
    <div
      data-toolbar-band="strip"
      className="h-8 px-1.5 border-b border-ink/10 bg-paper flex items-center gap-1 flex-shrink-0 select-none"
    >
      <div className="flex-1 min-w-0 flex items-center gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const label = tabLabel(tab);
          const url = tabUrl(tab);
          return (
            <div
              key={tab.id}
              ref={active ? activeRef : undefined}
              className={`group flex items-center rounded border flex-shrink-0 ${
                active
                  ? 'bg-ink text-canvas border-ink'
                  : 'bg-paper text-ink/70 border-ink/15 hover:border-ink/35 hover:text-ink'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(tab.id)}
                aria-pressed={active}
                aria-label={`Tab ${label}`}
                title={url ? `${label}\n${url}` : label}
                className={`pl-2 pr-1 py-0.5 text-[11px] font-mono max-w-[150px] truncate ${TAB_BUTTON}`}
              >
                {label}
              </button>
              <button
                type="button"
                onClick={() => onClose(tab.id)}
                aria-label={`Tutup tab ${label}`}
                title={`Tutup tab ${label}`}
                className={`mr-0.5 p-1 rounded hover:bg-error hover:text-paper ${TAB_BUTTON} ${
                  active ? 'text-on-ink-muted' : 'text-ink/40 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onNewTab}
        disabled={!canOpenTab}
        aria-label="Tab baru"
        title={canOpenTab ? 'Tab baru' : `Maksimal ${MAX_USER_BROWSER_TABS} tab`}
        className="p-1 rounded hover:bg-ink/5 text-ink/60 hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed cursor-pointer transition-colors flex-shrink-0"
      >
        <Plus size={13} />
      </button>
    </div>
  );
}
