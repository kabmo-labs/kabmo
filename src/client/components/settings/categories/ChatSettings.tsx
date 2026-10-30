import type { SettingsState } from '@/shared/types';
import { ChatLayoutSection } from '@/client/components/settings/categories/chat-settings/LayoutSection';
import { ChatToolRenderSection } from '@/client/components/settings/categories/chat-settings/ToolRenderSection';
import { ChatFollowUpSection } from '@/client/components/settings/categories/chat-settings/FollowUpSection';
import { ChatGoalSection } from '@/client/components/settings/categories/chat-settings/GoalSection';
import { ChatKeybindingsSection } from '@/client/components/settings/categories/chat-settings/KeybindingsSection';
import { ChatTitleSection } from '@/client/components/settings/categories/chat-settings/TitleSection';

interface ChatSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function ChatSettings({ settings, onUpdate }: ChatSettingsProps) {
  return (
    <div className="w-full space-y-7 text-xs text-ink pb-3">
      {/* 1. Chat Width (column width: compact / wide / full) */}
      <ChatLayoutSection settings={settings} onUpdate={onUpdate} />

      {/* 2. Tool Calls (card / compact / trace / minimal) */}
      <ChatToolRenderSection settings={settings} onUpdate={onUpdate} />

      {/* 3. Session Titles (automatic generation) */}
      <ChatTitleSection settings={settings} onUpdate={onUpdate} />

      {/* 4. Follow-up Behavior (Interactive Selector Cards) */}
      <ChatFollowUpSection settings={settings} onUpdate={onUpdate} />

      {/* 5. Goal Mode (auditor model + default budget) */}
      <ChatGoalSection settings={settings} onUpdate={onUpdate} />

      {/* 6. Keyboard Shortcuts Configurator */}
      <ChatKeybindingsSection settings={settings} onUpdate={onUpdate} />
    </div>
  );
}
