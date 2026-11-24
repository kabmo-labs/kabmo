/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice.
 *
 * Two groups, one direction each: Dictation (STT) for the microphone, Speech
 * (TTS) for the answer. The grouping is a NAVIGATION fact, so it lives in
 * `groups.ts`; this file is the only place that maps a group id to the component
 * drawing it — a new group fails to compile until it has a renderer.
 *
 * The two panes come from `SettingsMasterDetail`, the same shell Chats and
 * Appearance use: both panes are mounted at every width, and below `md` the
 * phone shows the list, then the group, with a back bar.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { SettingsState } from '@/shared/types';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GroupSidebar } from '@/client/components/settings/master-detail/GroupSidebar';
import { GroupDetail } from '@/client/components/settings/master-detail/GroupDetail';
import {
  VOICE_SETTING_GROUPS,
  type VoiceGroupId,
  type VoiceSectionId,
} from '@/client/components/settings/categories/voice-settings/groups';
import { DictationSettings } from '@/client/components/settings/categories/DictationSettings';
import { SpeechSettings } from '@/client/components/settings/categories/voice-settings/SpeechSettings';

interface VoiceSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

const SECTIONS: Record<VoiceSectionId, (props: VoiceSettingsProps) => ComponentChildren> = {
  dictation: DictationSettings,
  speech: SpeechSettings,
};

export function VoiceSettings({ settings, onUpdate }: VoiceSettingsProps) {
  const masterDetail = useSettingsMasterDetail();
  const [activeGroupId, setActiveGroupId] = useState<VoiceGroupId>(VOICE_SETTING_GROUPS[0].id);

  const group = VOICE_SETTING_GROUPS.find((entry) => entry.id === activeGroupId) ?? VOICE_SETTING_GROUPS[0];

  return (
    <SettingsMasterDetail
      pane={masterDetail.pane}
      onBack={masterDetail.back}
      listLabel="Voice settings"
      detailLabel={group.label}
      detailDescription={group.description}
      list={
        <GroupSidebar
          groups={VOICE_SETTING_GROUPS}
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
