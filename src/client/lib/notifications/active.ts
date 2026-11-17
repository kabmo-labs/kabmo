/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether this client is ASKED for system notifications at all.
 *
 * Two switches decide it, and both must hold: an event preference (the opt-in,
 * shipped false) and this device's delivery master. Only then does a banner —
 * and therefore an OS permission — matter. A fresh install has nothing to be
 * aware of, which is what keeps the permission prompt, and the denial dialog,
 * from appearing before the user has chosen anything.
 */

import { notificationPlatformForClient } from '@/client/lib/notifications/platform';
import { isNotificationEnabled, isNotificationPlatformEnabled } from '@/shared/lib/notifications/settings';

export function systemNotificationsActive(settings?: Record<string, any>): boolean {
  if (!isNotificationPlatformEnabled(notificationPlatformForClient(), settings)) return false;
  return (
    isNotificationEnabled('finish', settings) ||
    isNotificationEnabled('ask', settings) ||
    isNotificationEnabled('error', settings)
  );
}
