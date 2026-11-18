/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The native App menu's "Check for Updates…", shared by both layouts.
 *
 * The menu row cannot read the console's update state, and a second copy of the
 * request would be a second source of truth for the same check. The row
 * dispatches `omp:update-check`; whichever sidebar is mounted owns `useUpdates`
 * and runs the ONE check, then reports the verdict — the popup when a release is
 * available, a sentence when there is not.
 *
 * Both sidebars mount this hook because only one of them is on screen at a time,
 * and the rule "one check, one verdict" is easier to keep in one place than in
 * two handlers that have to stay identical.
 */

import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import { UPDATE_CHECK_EVENT, UPDATE_POPUP_OPEN_EVENT } from '@/shared/lib/updates/popup-state';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';

export function useUpdateCheckRequest(
  updates: UseUpdatesResult,
  pushToast: (message: string, type?: ToastTone) => void,
): void {
  useKabmoEvent(UPDATE_CHECK_EVENT, () => {
    void updates.check().then((result) => {
      // A failed check already has its own sentence in `updates.error`, and the
      // About modal shows it; a toast here would only repeat it.
      if (!result) return;
      if (result.kabmo.updateAvailable) {
        window.dispatchEvent(new CustomEvent(UPDATE_POPUP_OPEN_EVENT));
        return;
      }
      pushToast('Kabmo is up to date.', 'success');
    });
  });
}
