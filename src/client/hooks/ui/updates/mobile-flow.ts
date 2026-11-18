/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone drawer's update flow: the popup's "Update now" handover, the native
 * menu's check, and the shell offer the footer draws.
 *
 * Extracted from `MobileSessionSidebar` because that file is the drawer's
 * dispatcher and sits at the repo's per-file ceiling; the flow is one cohesive
 * unit (it owns `useUpdates` and every listener that acts on it), not a wrapper
 * around a single call.
 *
 * The handover is the phone's own rule: the popup's "Update now" must bring the
 * drawer forward, or the About modal opens over the chat while the user is
 * still looking at the session list they came from.
 */

import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useUpdates, type UseUpdatesResult } from '@/client/hooks/ui/updates';
import { useUpdateCheckRequest } from '@/client/hooks/ui/updates/check-request';
import { useShellOffer, type ShellDownload } from '@/client/hooks/ui/updates/shell-download';
import { UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';
import { updateOutcomeTone, type ToastTone } from '@/shared/lib/ui/toast-duration';

export interface MobileUpdateFlow {
  updates: UseUpdatesResult;
  /** An update inside a native shell, an install on an Android browser, nothing
   *  elsewhere — see `useShellOffer`. */
  shellDownload: ShellDownload | null;
}

export function useMobileUpdateFlow(args: {
  /** Bring the drawer forward before the About modal opens. */
  onClose: () => void;
  openAbout: () => void;
  pushToast: (message: string, type?: ToastTone) => void;
}): MobileUpdateFlow {
  const updates = useUpdates();
  const shellDownload = useShellOffer();

  useKabmoEvent(UPDATE_REQUEST_EVENT, () => {
    args.onClose();
    args.openAbout();
    void updates.apply('kabmo').then((result) => {
      if (!result) return;
      args.pushToast(result.message, updateOutcomeTone(result));
    });
  });

  // The same native row as the desktop's: one check, one verdict, drawer stays.
  useUpdateCheckRequest(updates, args.pushToast);

  return { updates, shellDownload };
}
