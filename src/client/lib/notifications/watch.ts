/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tell a phone shell whether it should keep watching while the console is away.
 *
 * The event switches live in the server's settings, and the shell has no page
 * to ask once the app is backgrounded — so the answer is pushed to it here, on
 * boot and whenever a switch changes. The shell persists it and starts its
 * watcher from `onStop` only when it is armed.
 *
 * A no-op outside a phone shell: the desktop shells and a browser have no
 * background watcher, and their notifications are posted by the page itself.
 */

import { callShell, shellHost } from '@/client/lib/shell/transport';
import { isNotificationEnabled, isNotificationPlatformEnabled } from '@/shared/lib/notifications/settings';

/**
 * Whether any event is switched on AND this device class is allowed to banner.
 *
 * `settings` is passed by the Notifications page, whose own state is ahead of
 * the primed snapshot by one write; the boot call omits it and reads the
 * snapshot the page was served with.
 */
export function nativeNotificationWatchWanted(settings?: Record<string, any>): boolean {
  if (!isNotificationPlatformEnabled('mobile', settings)) return false;
  return (
    isNotificationEnabled('finish', settings) ||
    isNotificationEnabled('ask', settings) ||
    isNotificationEnabled('error', settings)
  );
}

/** Push the current answer to the shell. Safe to call on every settings change. */
export function syncNativeNotificationWatch(settings?: Record<string, any>): void {
  // Android only: it is the one shell with a background watcher. iOS has no
  // background connection, and a desktop shell posts from the page itself.
  if (typeof window === 'undefined' || shellHost() !== 'android') return;
  const enabled = nativeNotificationWatchWanted(settings);
  void callShell('notification_watch', { enabled: enabled ? 'true' : 'false' }).catch((error) => {
    // An older APK does not know the command; the page's own banners still work
    // while the app is open, so this is reported and not retried.
    console.warn('[notifications] the shell could not arm the background watcher:', error);
  });
}
