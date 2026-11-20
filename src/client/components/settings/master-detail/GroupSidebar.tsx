/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The list pane every grouped settings category shares: one row per group, the
 * same shape the Usage category's provider list uses (a mark, a name, a
 * one-line hint, the active row tinted). Width and border belong to the pane,
 * not to the row: the master detail shell stacks the two panes on a phone,
 * where the list is full width.
 *
 * It lives here because Chats and Appearance both navigate by GROUP and
 * already agreed on every pixel of that row; a second copy is how one category's
 * hint wraps differently from another's. A category keeps its own groups as
 * DATA (`chat-settings/groups.ts`, `appearance-settings/groups.ts`) and this
 * file draws whatever it is handed.
 */

import type { LucideIcon } from 'lucide-preact';
import { SETTINGS_BAND, SETTINGS_BAND_HEIGHT } from '@/client/components/settings/pane-header';

/** What a grouped category's sidebar needs from one group. */
export interface SettingsGroup<Id extends string = string> {
  id: Id;
  label: string;
  /** One line under the label in the sidebar. */
  hint: string;
  icon: LucideIcon;
}

interface GroupSidebarProps<Id extends string> {
  groups: readonly SettingsGroup<Id>[];
  activeGroupId: Id;
  onSelectGroup: (id: Id) => void;
}

export function GroupSidebar<Id extends string>({
  groups,
  activeGroupId,
  onSelectGroup,
}: GroupSidebarProps<Id>) {
  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0 select-none">
      <div className={`${SETTINGS_BAND} px-3.5 justify-between`} style={{ height: SETTINGS_BAND_HEIGHT }}>
        <span className="text-xs font-semibold text-ink">
          {groups.length} group{groups.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 text-xs">
        <div className="space-y-0.5">
          {groups.map((group) => {
            const isActive = group.id === activeGroupId;
            const Icon = group.icon;

            return (
              <button
                key={group.id}
                type="button"
                onClick={() => onSelectGroup(group.id)}
                aria-current={isActive ? 'true' : undefined}
                // The name is stated once, explicitly: the row carries both the
                // label and the hint, and without this a screen reader reads
                // `LayoutChat width and composer shape` as one run-together
                // word. The hint is part of the name because it is what tells a
                // reader which row they want.
                aria-label={`${group.label}: ${group.hint}`}
                className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex flex-col gap-0.5 ${
                  isActive
                    ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                    : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                }`}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    aria-hidden
                    className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 ${
                      isActive ? 'bg-ink/10 text-ink' : 'bg-ink/5 text-ink/70'
                    }`}
                  >
                    <Icon size={12} />
                  </span>
                  <span className="font-semibold text-xs text-ink truncate">{group.label}</span>
                </span>
                <span className="text-[11px] text-ink/60 line-clamp-1 leading-snug pl-[26px]">
                  {group.hint}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
