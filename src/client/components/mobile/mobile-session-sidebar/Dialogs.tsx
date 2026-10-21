/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone session drawer's dialogs.
 *
 * Split out of `SessionSidebar` for the file ceiling, and it is a clean seam:
 * every one of these is app-level (a workspace, a schedule, the console's own
 * version and update, a batch delete confirmation, the toast stack) and none of
 * them reads the drawer's own view state. Keeping them here also means the
 * drawer's body — session list or a placed panel — stays readable as one
 * expression rather than being buried between modals.
 */

import { ToastStack } from '@/client/components/common/ToastStack';
import { AboutModal, NewWorkspaceModal } from '@/client/components/layout/session-sidebar/Modals';
import { SchedulerModal } from '@/client/components/layout/session-sidebar/scheduler-modal';
import { UpdatePopup } from '@/client/components/layout/update-popup';
import { BatchDeleteModal } from '@/client/components/common/batch-selection/BatchDeleteModal';
import { createWorkspaceFolder, cloneWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import type { BatchDeleteRun } from '@/client/hooks/workspace/batch-delete-run';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import type { ToastsHandle } from '@/client/hooks/ui/toasts';

interface MobileDrawerDialogsProps {
  activeSessionId: number | string | null;
  newWorkspaceOpen: boolean;
  onCloseNewWorkspace: () => void;
  schedulerOpen: boolean;
  onCloseScheduler: () => void;
  aboutOpen: boolean;
  onCloseAbout: () => void;
  updates: UseUpdatesResult;
  pushToast: ToastsHandle['pushToast'];
  batchDelete: BatchDeleteRun;
  /** The batch mode the confirmation names, and the way out of it. */
  batchMode: 'workspace' | 'session' | null;
  onEndBatch: () => void;
  scopeLabel?: string;
  toasts: ToastsHandle['toasts'];
  dismissToast: ToastsHandle['dismissToast'];
}

export function MobileDrawerDialogs({
  activeSessionId,
  newWorkspaceOpen,
  onCloseNewWorkspace,
  schedulerOpen,
  onCloseScheduler,
  aboutOpen,
  onCloseAbout,
  updates,
  pushToast,
  batchDelete,
  batchMode,
  onEndBatch,
  scopeLabel,
  toasts,
  dismissToast,
}: MobileDrawerDialogsProps) {
  return (
    <>
      <NewWorkspaceModal
        isOpen={newWorkspaceOpen}
        onClose={onCloseNewWorkspace}
        onCreate={createWorkspaceFolder}
        onClone={cloneWorkspaceFolder}
      />
      <SchedulerModal
        isOpen={schedulerOpen}
        onClose={onCloseScheduler}
        activeSessionId={activeSessionId === null ? null : String(activeSessionId)}
        onToast={pushToast}
      />
      <AboutModal isOpen={aboutOpen} onClose={onCloseAbout} updates={updates} onToast={pushToast} />

      {/* "Update available" announcement — once per version, gated on the check.
          Its "Update now" hands the run to the About modal. */}
      <UpdatePopup updates={updates} />

      {/* Batch delete confirmation — same dialog the desktop draws. */}
      <BatchDeleteModal
        mode={batchMode ?? 'session'}
        count={batchDelete.pending.length}
        scopeLabel={scopeLabel}
        isDeleting={batchDelete.isDeleting}
        outcome={batchDelete.outcome}
        onClose={() => {
          const refusedCount = batchDelete.outcome?.refused.length ?? 0;
          batchDelete.cancel();
          if (batchDelete.outcome && refusedCount === 0) onEndBatch();
        }}
        onConfirm={() => {
          const mode = batchMode ?? 'session';
          void batchDelete.confirm(mode).then((result) => {
            if (result && result.refused.length === 0) onEndBatch();
          });
        }}
      />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
