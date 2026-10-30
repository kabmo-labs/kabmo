/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Chats, the list pane: one row per group, the same shape the Usage
 * category's provider list uses (a mark, a name, a one-line hint, the active
 * row tinted). Width and border belong to the pane, not to the row: the master
 * detail shell stacks the two panes on a phone, where the list is full width.
 */

import type { ChatSettingGroup, ChatSettingGroupId } from '@/client/components/settings/categories/chat-settings/groups';

interface ChatSettingsSidebarProps {
  groups: readonly ChatSettingGroup[];
  activeGroupId: ChatSettingGroupId;
  onSelectGroup: (id: ChatSettingGroupId) => void;
}

export function ChatSettingsSidebar({
  groups,
  activeGroupId,
  onSelectGroup,
}: ChatSettingsSidebarProps) {
  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0 select-none">
      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
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
