/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which page a settings category draws.
 *
 * Split out of `Modal.tsx` when that file reached the 350-line ceiling: the
 * switch is a pure function of the category and a handful of callbacks, and
 * keeping it beside the modal's own state made every new category a change to a
 * file that also owns focus, search and the restart flow.
 *
 * The `default` branch is the harness pages: a single-harness category carries a
 * dynamic id (`harness:claude`), so it cannot be a `case` here.
 */

import type { SettingsCategoryId, SettingsState } from '@/shared/types';
import { harnessIdFromCategory } from '@/shared/lib/harness/menu';
import { AppearanceSettings } from '@/client/components/settings/categories/AppearanceSettings';
import { ChatSettings } from '@/client/components/settings/categories/ChatSettings';
import { DictationSettings } from '@/client/components/settings/categories/DictationSettings';
import { KeyboardSettings } from '@/client/components/settings/categories/KeyboardSettings';
import { ProjectSettings } from '@/client/components/settings/categories/ProjectSettings';
import { GitSettings } from '@/client/components/settings/categories/GitSettings';
import { ProviderSettings } from '@/client/components/settings/categories/ProviderSettings';
import { AgentSettings } from '@/client/components/settings/categories/AgentSettings';
import { BehaviorSettings } from '@/client/components/settings/categories/BehaviorSettings';
import { CommandSettings } from '@/client/components/settings/categories/CommandSettings';
import { McpSettings } from '@/client/components/settings/categories/McpSettings';
import { HarnessSettings } from '@/client/components/settings/categories/HarnessSettings';
import { SkillSettings } from '@/client/components/settings/categories/SkillSettings';
import { PluginSettings } from '@/client/components/settings/categories/PluginSettings';
import { PanelPluginSettings } from '@/client/components/settings/categories/PanelPluginSettings';
import { SkillCatalogSettings, type CatalogTab } from '@/client/components/settings/categories/SkillCatalogSettings';
import { OtherSettings } from '@/client/components/settings/categories/OtherSettings';
import { OmpSettings } from '@/client/components/settings/categories/OmpSettings';
import { TokenUsageSettings } from '@/client/components/settings/categories/TokenUsageSettings';
import { UsageSettings } from '@/client/components/settings/categories/UsageSettings';
import { NotificationSettings } from '@/client/components/settings/categories/NotificationSettings';
import { ConnectSettings } from '@/client/components/settings/categories/ConnectSettings';

export interface CategoryContentProps {
  category: SettingsCategoryId;
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
  /** The provider dialog was asked for by a caller, not by a click in the page. */
  autoOpenAdd: boolean;
  onAddModalClose: () => void;
  /** Which catalog tab a navigation asked for; the catalog owns it once mounted. */
  catalogTab: CatalogTab;
  onNavigateToCatalog: (tab?: CatalogTab) => void;
}

export function CategoryContent({
  category,
  settings,
  onUpdate,
  autoOpenAdd,
  onAddModalClose,
  catalogTab,
  onNavigateToCatalog,
}: CategoryContentProps) {
  switch (category) {
    case 'appearance':
      return <AppearanceSettings settings={settings} onUpdate={onUpdate} />;
    case 'chats':
      return <ChatSettings settings={settings} onUpdate={onUpdate} />;
    case 'dictation':
      return <DictationSettings settings={settings} onUpdate={onUpdate} />;
    case 'keyboard':
      return <KeyboardSettings settings={settings} onUpdate={onUpdate} />;
    case 'projects':
      return <ProjectSettings />;
    case 'git':
      return <GitSettings settings={settings} onUpdate={onUpdate} />;
    case 'providers':
      return <ProviderSettings autoOpenAdd={autoOpenAdd} onAddModalClose={onAddModalClose} />;
    case 'agents':
      return <AgentSettings settings={settings} onUpdate={onUpdate} />;
    case 'harness-index':
      return <HarnessSettings />;
    case 'behavior':
      return <BehaviorSettings />;
    case 'commands':
      return <CommandSettings settings={settings} onUpdate={onUpdate} />;
    case 'mcp':
      return <McpSettings settings={settings} onUpdate={onUpdate} />;
    case 'token-usage':
      return <TokenUsageSettings settings={settings} onUpdate={onUpdate} />;
    case 'notifications':
      return <NotificationSettings settings={settings} onUpdate={onUpdate} />;
    case 'connect':
      return <ConnectSettings />;
    case 'plugins':
      return <PluginSettings />;
    case 'panel-plugins':
      return <PanelPluginSettings />;
    case 'skills':
      return (
        <SkillSettings
          settings={settings}
          onUpdate={onUpdate}
          onNavigateToCatalog={onNavigateToCatalog}
        />
      );
    case 'skills-catalog':
      return <SkillCatalogSettings initialTab={catalogTab} />;
    case 'omp':
      return <OmpSettings settings={settings} onUpdate={onUpdate} />;
    case 'usage':
      return <UsageSettings />;
    default: {
      // A single harness page: its own card, verbatim — the same component the
      // overview draws, because a second renderer for one agent is how the two
      // views start disagreeing about what it can do.
      const harnessId = harnessIdFromCategory(category);
      if (harnessId) return <HarnessSettings only={harnessId} />;
      return <OtherSettings category={category} />;
    }
  }
}
