/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Chats.
 *
 * Seven sections, four groups: the sidebar in `groups.ts` decides what a reader
 * sees first, and this file is the only place that maps a section id to the
 * component drawing it. The `Record<ChatSectionId, …>` is deliberate — a new
 * section id fails to compile until it has a renderer, and `groups.test.ts`
 * fails until a group owns it, so neither half can drift.
 *
 * The two panes come from `SettingsMasterDetail`, the same shell Usage,
 * Providers, Projects and the other list categories use: both panes are mounted
 * at every width, and below `md` the phone shows the list, then the group, with
 * a back bar — so a half-scrolled group and the selected row both survive the
 * drill.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { SettingsState } from '@/shared/types';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { ChatSettingsSidebar } from '@/client/components/settings/categories/chat-settings/SidebarList';
import {
  CHAT_SETTING_GROUPS,
  type ChatSectionId,
  type ChatSettingGroupId,
} from '@/client/components/settings/categories/chat-settings/groups';
import { ChatLayoutSection } from '@/client/components/settings/categories/chat-settings/LayoutSection';
import { ComposerStyleSection } from '@/client/components/settings/categories/chat-settings/ComposerStyleSection';
import { ChatToolRenderSection } from '@/client/components/settings/categories/chat-settings/ToolRenderSection';
import { ChatFollowUpSection } from '@/client/components/settings/categories/chat-settings/FollowUpSection';
import { ChatTitleSection } from '@/client/components/settings/categories/chat-settings/TitleSection';
import { ChatGoalSection } from '@/client/components/settings/categories/chat-settings/GoalSection';
import { ChatKeybindingsSection } from '@/client/components/settings/categories/chat-settings/KeybindingsSection';

interface ChatSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

type SectionProps = ChatSettingsProps;

/** Every section id, and the component that draws it. */
const SECTIONS: Record<ChatSectionId, (props: SectionProps) => ComponentChildren> = {
  width: ChatLayoutSection,
  composer: ComposerStyleSection,
  'tool-calls': ChatToolRenderSection,
  'follow-up': ChatFollowUpSection,
  titles: ChatTitleSection,
  goal: ChatGoalSection,
  keybindings: ChatKeybindingsSection,
};

export function ChatSettings({ settings, onUpdate }: ChatSettingsProps) {
  const masterDetail = useSettingsMasterDetail();
  const [activeGroupId, setActiveGroupId] = useState<ChatSettingGroupId>(CHAT_SETTING_GROUPS[0].id);

  const group = CHAT_SETTING_GROUPS.find((entry) => entry.id === activeGroupId) ?? CHAT_SETTING_GROUPS[0];

  return (
    <SettingsMasterDetail
      pane={masterDetail.pane}
      onBack={masterDetail.back}
      listLabel="Chat settings"
      list={
        <ChatSettingsSidebar
          groups={CHAT_SETTING_GROUPS}
          activeGroupId={group.id}
          onSelectGroup={(id) => {
            setActiveGroupId(id);
            masterDetail.openDetail();
          }}
        />
      }
      detail={
        <div className="flex-1 h-full overflow-hidden flex flex-col text-xs text-ink">
          <div className="px-3.5 py-2.5 border-b border-ink/10 flex-shrink-0">
            <span className="text-xs font-semibold text-ink/75">{group.label}</span>
            <p className="text-[11px] text-ink/60 leading-snug mt-0.5">{group.description}</p>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-overlay-container p-3.5 space-y-7 pb-6">
            {group.sections.map((id) => {
              const Section = SECTIONS[id];
              return <Section key={id} settings={settings} onUpdate={onUpdate} />;
            })}
          </div>
        </div>
      }
    />
  );
}
