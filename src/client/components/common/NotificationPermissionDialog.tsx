/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The dialog that makes a blocked grant impossible to miss.
 *
 * The Notifications page states a denial, but a user who never opens that page
 * sees nothing at all: the switches read "on", the server records the event, the
 * shell posts it, and the platform drops it — banner and chime both. Measured on
 * macOS 26: `usernoted` logged `authorizationStatus: Denied` and
 * `Presenting … as none` while `[.banner, .list, .sound]` was what the delegate
 * asked for.
 *
 * Two states warrant it, and only when notifications are actually ACTIVE (an
 * event preference plus this device's master — see `systemNotificationsActive`):
 *
 * - `denied`: the system will drop everything until the user flips the switch in
 *   the system settings, so the dialog opens that screen;
 * - `notDetermined`: the preference exists but the platform was never asked, so
 *   the dialog asks (from a click, which a browser requires).
 *
 * `unknown` does not: a shell with no permission model has refused nothing, and
 * a warning that cannot be acted on is worse than silence.
 *
 * Dismissal is per page load, not persisted: the fact is still true on the next
 * boot, and the console is the place that knows whether it is still true.
 */

import { createPortal } from 'preact/compat';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { BellRing } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { systemNotificationsActive } from '@/client/lib/notifications/active';
import {
  notificationPermission,
  openNotificationSettings,
  readNotificationGrant,
  requestNotificationPermission,
  type NotificationPermission,
} from '@/client/lib/notifications/os';

export function NotificationPermissionDialog() {
  const [grant, setGrant] = useState<NotificationPermission>(notificationPermission);
  const [canOpenSettings, setCanOpenSettings] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [asking, setAsking] = useState(false);

  const refresh = useCallback(async () => {
    const answer = await readNotificationGrant();
    setGrant(answer.status);
    setCanOpenSettings(answer.canOpenSettings);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The fix happens in the system settings; re-read when the user comes back
  // rather than making them reload the console.
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  if (dismissed || (grant !== 'denied' && grant !== 'notDetermined') || !systemNotificationsActive()) {
    return null;
  }

  const ask = async () => {
    setAsking(true);
    const granted = await requestNotificationPermission();
    setAsking(false);
    if (granted) {
      setGrant('granted');
      setDismissed(true);
      return;
    }
    // A refusal inside the prompt is the denied case: the dialog stays, and the
    // button it offers becomes the one that opens the system settings. The
    // answer is trusted rather than re-read — a platform read taken this instant
    // can still report `notDetermined` for the prompt that just closed.
    setGrant('denied');
  };

  const close = () => setDismissed(true);

  return createPortal(
    <Modal
      onClose={close}
      zClass="z-[70]"
      ariaLabel="Notifications are turned off for Kabmo"
      header={
        <div className="flex min-w-0 items-center gap-3">
          <BellRing size={16} className="shrink-0 text-ink/70" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Notifications are turned off</h2>
            <p className="truncate text-[11px] text-ink/50">
              Kabmo cannot show a banner or play its chime
            </p>
          </div>
        </div>
      }
      // ONE dismissal control. The footer used to offer "Not now" beside the
      // shell's own `X`, and both ran the same `close()` — two controls, one
      // action, on the dialog that exists to be answered. The shell's close is
      // the dismissal (it is named, and it is where every other dialog's is);
      // the footer keeps only the ACTIONS, which is what a footer is for.
      footer={
        <div className="flex flex-wrap justify-end gap-2 border-t border-ink/10 px-5 py-3">
          {grant === 'denied' ? (
            canOpenSettings ? (
              <button
                type="button"
                onClick={() => {
                  close();
                  void openNotificationSettings();
                }}
                className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[11px] font-medium text-paper hover:bg-ink/90"
              >
                Open system settings
              </button>
            ) : null
          ) : (
            <button
              type="button"
              onClick={() => void ask()}
              disabled={asking}
              className="rounded-md border border-ink bg-ink px-3 py-1.5 text-[11px] font-medium text-paper hover:bg-ink/90 disabled:opacity-60"
            >
              {asking ? 'Asking…' : 'Allow notifications'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-2 px-5 py-4 text-xs leading-relaxed text-ink/75">
        {grant === 'denied' ? (
          <>
            <p>
              You asked Kabmo to notify you when a run finishes, waits for you or fails — but the
              system is blocking it. Every banner, and the sound it carries, is dropped before it
              reaches you.
            </p>
            <p>
              Allow Kabmo in your system notification settings. This dialog disappears on its own
              once the grant is there.
            </p>
          </>
        ) : (
          <>
            <p>
              You asked Kabmo to notify you when a run finishes, waits for you or fails. The system
              has not been asked for permission yet, so nothing can arrive until it is.
            </p>
            <p>Allow notifications and the console will send them whether or not you are looking.</p>
          </>
        )}
      </div>
    </Modal>,
    document.body,
  );
}
