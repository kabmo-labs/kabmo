/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Keyboard.
 *
 * Two axes, one page: the COMMANDS (rebindable, stored in `kabmo_settings`) and
 * the composer's three Enter behaviours (a different axis — they decide what a
 * key does inside one field, not which command runs). They used to live under
 * Chats, which made "keybindings" mean two things in two places.
 */

import type { SettingsState } from '@/shared/types';
import { ShortcutTable } from '@/client/components/settings/categories/keyboard-settings/ShortcutTable';
import { ComposerKeysSection } from '@/client/components/settings/categories/keyboard-settings/ComposerKeys';

interface KeyboardSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function KeyboardSettings({ settings, onUpdate }: KeyboardSettingsProps) {
  return (
    <div className="flex-1 h-full overflow-y-auto scrollbar-overlay-container p-4 md:p-6 space-y-8 pb-8">
      <ShortcutTable />
      <ComposerKeysSection settings={settings} onUpdate={onUpdate} />
    </div>
  );
}
