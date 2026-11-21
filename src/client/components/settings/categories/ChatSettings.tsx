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
import { GroupSidebar } from '@/client/components/settings/master-detail/GroupSidebar';
import { GroupDetail } from '@/client/components/settings/master-detail/GroupDetail';
import {
  CHAT_SETTING_GROUPS,
  type ChatSectionId,
  type ChatSettingGroupId,
} from '@/client/components/settings/categories/chat-settings/groups';
import { ChatLayoutSection } from '@/client/components/settings/categories/chat-settings/LayoutSection';
import { ComposerStyleSection } from '@/client/components/settings/categories/chat-settings/ComposerStyleSection';
import { ChatToolRenderSection } from '@/client/components/settings/categories/chat-settings/ToolRenderSection';
import { ChatChangedFilesSection } from '@/client/components/settings/categories/chat-settings/ChangedFilesSection';
import { ChatFollowUpSection } from '@/client/components/settings/categories/chat-settings/FollowUpSection';
import { ChatTitleSection } from '@/client/components/settings/categories/chat-settings/TitleSection';
import { ChatGoalSection } from '@/client/components/settings/categories/chat-settings/GoalSection';

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
  'changed-files': ChatChangedFilesSection,
  'follow-up': ChatFollowUpSection,
  titles: ChatTitleSection,
  goal: ChatGoalSection,
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
      detailLabel={group.label}
      detailDescription={group.description}
      list={
        <GroupSidebar
          groups={CHAT_SETTING_GROUPS}
          activeGroupId={group.id}
          onSelectGroup={(id) => {
            setActiveGroupId(id);
            masterDetail.openDetail();
          }}
        />
      }
      detail={
        <GroupDetail group={group}>
          {group.sections.map((id) => {
            const Section = SECTIONS[id];
            return <Section key={id} settings={settings} onUpdate={onUpdate} />;
          })}
        </GroupDetail>
      }
    />
  );
}
