/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Git.
 *
 * The Source Control panel's own preferences. Today that is commit-message
 * generation: which agent writes it, which model, and the prompt template. The
 * category lives under WORKSPACE because the panel is a workspace surface, not
 * a chat preference — the same reason Projects is there.
 */

import type { SettingsState } from '@/shared/types';
import { IdentitySection } from '@/client/components/settings/categories/git-settings/IdentitySection';
import { CommitMessageSection } from '@/client/components/settings/categories/git-settings/CommitMessageSection';

interface GitSettingsProps {
  settings: SettingsState;
  onUpdate: (updater: Partial<SettingsState> | ((prev: SettingsState) => SettingsState)) => void;
}

export function GitSettings({ settings, onUpdate }: GitSettingsProps) {
  return (
    <div className="w-full space-y-6 text-xs text-ink">
      <IdentitySection settings={settings} onUpdate={onUpdate} />
      <CommitMessageSection settings={settings} onUpdate={onUpdate} />
    </div>
  );
}
