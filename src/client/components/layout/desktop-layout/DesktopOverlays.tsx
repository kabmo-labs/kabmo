/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The layout's own modals: Settings and the delete confirmation.
 *
 * Extracted from `DesktopLayout` for the repository's per-file ceiling, and it
 * earns the boundary: both are overlays the LAYOUT mounts (the settings dialog
 * and the navbar title menu's delete path have no other home on this layout),
 * and neither reads the workspace's state.
 */

import { SettingsModal } from '@/client/components/settings/LazyModal';
import { SessionDeleteModal } from '@/client/components/common/session-delete-modal';
import type { SettingsModalState } from '@/client/hooks/ui/settings-modal';
import type { SessionDeleteActions } from '@/client/hooks/workspace/session-delete';

export function DesktopOverlays({
  settings,
  sessionDelete,
  appSettings,
}: {
  settings: SettingsModalState;
  sessionDelete: SessionDeleteActions;
  appSettings: Record<string, any>;
}) {
  return (
    <>
      <SettingsModal
        isOpen={settings.isOpen}
        onClose={settings.close}
        initialCategory={settings.category}
        autoOpenAddProvider={settings.autoOpenAddProvider}
        appSettings={appSettings}
      />

      {/* The navbar title menu's delete path and the rename-with-AI refusal
          surface here: this layout owns no sidebar, so it must render its own
          confirmation and toast stack. */}
      <SessionDeleteModal
        session={sessionDelete.pending}
        isDeleting={sessionDelete.isDeleting}
        error={sessionDelete.error}
        onClose={sessionDelete.cancelDelete}
        onConfirm={() => void sessionDelete.confirmDelete()}
      />
    </>
  );
}
