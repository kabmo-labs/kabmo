/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The New Workspace dialog, mounted by the chat that offers it.
 *
 * The composer's workspace picker has an "Add new workspace" row, and the
 * dialog cannot live in either sidebar: the desktop dock unmounts the session
 * list while it shows a plugin panel, and the phone's drawer is a screen the
 * chat can be shown without. So the picker ASKS over `omp:new-workspace` and
 * this host answers, for as long as the pending chat (the only view with that
 * picker) is on screen.
 */

import { useState } from 'preact/hooks';
import { NewWorkspaceModal } from '@/client/components/layout/session-sidebar/Modals';
import { createWorkspaceFolder, cloneWorkspaceFolder } from '@/client/hooks/workspace/new-workspace';
import { NEW_WORKSPACE_EVENT } from '@/shared/lib/workspace/new-workspace';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';

export function NewWorkspaceHost() {
  const [open, setOpen] = useState(false);
  useKabmoEvent(NEW_WORKSPACE_EVENT, () => setOpen(true));

  return (
    <NewWorkspaceModal
      isOpen={open}
      onClose={() => setOpen(false)}
      onCreate={createWorkspaceFolder}
      onClone={cloneWorkspaceFolder}
    />
  );
}
