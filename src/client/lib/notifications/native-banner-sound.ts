/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether the NATIVE banner owns the chime for this event.
 *
 * Inside a Kabmo shell the OS notification plays the Kabmo sound itself
 * (`packages/notification-sound/`). The page must then NOT play its Web Audio
 * cue: the two arrive for the same event within a few hundred milliseconds, and
 * hearing the same chime twice is the bug this module exists to prevent.
 *
 * A browser — desktop Chrome, an installed PWA — has no sound slot on its
 * `Notification`, so the page keeps playing the cue there. That is the whole
 * rule: the sound follows whoever can carry it, exactly once.
 *
 * Three conditions, all required:
 *
 * - a shell bridge, because only a shell can put a sound in a notification;
 * - the platform master ON for this device class, because a silenced shell posts
 *   no banner — and then the page's cue is the only sound there is;
 * - the event switch ON, because the server does not even record a silenced
 *   event, so no banner (and no chime) would arrive.
 *
 * The event switches ship FALSE, which is why the page still plays its cue on a
 * fresh install: nothing has been switched on, so nothing else is making sound.
 */

import { hasShellBridge } from '@/client/lib/shell/transport';
import { notificationPlatformForClient } from '@/client/lib/notifications/platform';
import {
  isNotificationEnabled,
  isNotificationPlatformEnabled,
  type NotificationEvent,
} from '@/shared/lib/notifications/settings';

export function nativeBannerPlaysSound(
  event: NotificationEvent,
  appSettings?: Record<string, any>,
): boolean {
  if (typeof window === 'undefined') return false;
  if (!hasShellBridge()) return false;
  if (!isNotificationPlatformEnabled(notificationPlatformForClient(), appSettings)) return false;
  return isNotificationEnabled(event, appSettings);
}
