/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `⋯` menu the desktop sidebar toolbar falls back to when its row cannot
 * hold every control.
 *
 * The row has one primary button plus seven icon controls, and the sidebar is
 * 264–500px wide on any screen — so at the narrow end something has to give.
 * Hiding a control outright is not an option (the phone already learned that a
 * feature reachable only at one width is a feature half the users never find),
 * and letting the row overflow hides controls behind a horizontal scroll with
 * nothing on screen to say so. The menu is the third answer: the controls that
 * do not fit are still one click away, named in words rather than as glyphs.
 */

import { Ellipsis, type LucideIcon } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { SortMenu } from '@/client/components/common/sort-menu';
import type { SessionSortOption } from '@/shared/types';
import type { SidebarToolbarControl } from '@/shared/lib/workspace/sidebar-toolbar';

/** One overflow row: what it says and what it does. */
export interface OverflowAction {
  id: SidebarToolbarControl;
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Rendered as a pressed row (archive currently shown). */
  active?: boolean;
}

interface ToolbarOverflowMenuProps {
  actions: OverflowAction[];
  /** True when the SORT control itself is in the menu. */
  sortHidden: boolean;
  sortOption: SessionSortOption;
  onSortChange: (option: SessionSortOption) => void;
}

export function ToolbarOverflowMenu({
  actions,
  sortHidden,
  sortOption,
  onSortChange,
}: ToolbarOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(rootRef, () => setOpen(false));

  // Escape closes the menu from anywhere, including while a row has focus.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const run = (action: OverflowAction) => {
    setOpen(false);
    action.onSelect();
  };

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        title="More sidebar actions"
        aria-label="More sidebar actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`w-7 h-7 inline-flex items-center justify-center rounded border transition-colors cursor-pointer ${
          open
            ? 'border-ink/30 bg-ink/10 text-ink'
            : 'border-ink/15 bg-paper text-ink/70 hover:bg-ink/5 hover:text-ink'
        }`}
      >
        <Ellipsis size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-2 w-52 bg-paper border border-ink/15 rounded-lg shadow-lg z-50 py-1 text-xs"
        >
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              onClick={() => run(action)}
              aria-pressed={action.active}
              className={`w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors ${
                action.active ? 'bg-ink/5 text-ink font-medium' : 'text-ink/75 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              <action.icon size={13} />
              <span>{action.label}</span>
            </button>
          ))}

          {sortHidden && (
            <div className="mt-1 border-t border-ink/10 pt-1">
              <SortMenu variant="desktop" sortOption={sortOption} onSortChange={onSortChange} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
