/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Appearance.
 *
 * Four groups over twelve sections: the sidebar in `groups.ts` decides what a
 * reader sees first, and this file is the only place that maps a section id to
 * the component drawing it. The `Record<AppearanceSectionId, …>` is deliberate —
 * a new section id fails to compile until it has a renderer, and
 * `groups.test.ts` fails until a group owns it, so neither half can drift.
 *
 * Before this, the category was one scrolling column: a hundred-odd cards, in
 * which moving the session sidebar meant scrolling past every palette and every
 * editor theme. Grouping is the same answer Settings → Chats uses, and the two
 * panes come from the same `SettingsMasterDetail` shell — both panes are mounted
 * at every width, and below `md` the phone shows the list, then the group, with
 * a back bar.
 */

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import type { SettingsState } from '@/shared/types';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { GroupSidebar } from '@/client/components/settings/master-detail/GroupSidebar';
import { GroupDetail } from '@/client/components/settings/master-detail/GroupDetail';
import {
  APPEARANCE_GROUPS,
  type AppearanceGroupId,
  type AppearanceSectionId,
} from '@/client/components/settings/categories/appearance-settings/groups';
import { ThemeSection } from '@/client/components/settings/categories/appearance-settings/ThemeSection';
import { SidebarStyleSection } from '@/client/components/settings/categories/appearance-settings/SidebarStyleSection';
import { PanelNavSection } from '@/client/components/settings/categories/appearance-settings/PanelNavSection';
import { SurfaceStyleSection } from '@/client/components/settings/categories/appearance-settings/SurfaceStyleSection';
import { BorderStyleSection } from '@/client/components/settings/categories/appearance-settings/BorderStyleSection';
import { IconStyleSection } from '@/client/components/settings/categories/appearance-settings/IconStyleSection';
import { TrayIconSection } from '@/client/components/settings/categories/appearance-settings/TrayIconSection';
import { EditorFontSection } from '@/client/components/settings/categories/appearance-settings/EditorFontSection';
import { EditorThemeSection } from '@/client/components/settings/categories/appearance-settings/EditorThemeSection';
import { EditorIndentSection } from '@/client/components/settings/categories/appearance-settings/EditorIndentSection';
import { EditorTypingSection } from '@/client/components/settings/categories/appearance-settings/EditorTypingSection';
import { EditorBlameSection } from '@/client/components/settings/categories/appearance-settings/EditorBlameSection';

interface AppearanceSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

type SectionProps = AppearanceSettingsProps;

/** Every section id, and the component that draws it. */
const SECTIONS: Record<AppearanceSectionId, (props: SectionProps) => ComponentChildren> = {
  theme: ThemeSection,
  sidebar: SidebarStyleSection,
  'panel-nav': PanelNavSection,
  surface: SurfaceStyleSection,
  border: BorderStyleSection,
  icons: IconStyleSection,
  tray: TrayIconSection,
  'editor-font': EditorFontSection,
  'editor-theme': EditorThemeSection,
  'editor-indent': EditorIndentSection,
  'editor-typing': EditorTypingSection,
  'editor-blame': EditorBlameSection,
};

export function AppearanceSettings({ settings, onUpdate }: AppearanceSettingsProps) {
  const masterDetail = useSettingsMasterDetail();
  const [activeGroupId, setActiveGroupId] = useState<AppearanceGroupId>(APPEARANCE_GROUPS[0].id);

  const group =
    APPEARANCE_GROUPS.find((entry) => entry.id === activeGroupId) ?? APPEARANCE_GROUPS[0];

  return (
    <SettingsMasterDetail
      pane={masterDetail.pane}
      onBack={masterDetail.back}
      listLabel="Appearance settings"
      list={
        <GroupSidebar
          groups={APPEARANCE_GROUPS}
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
