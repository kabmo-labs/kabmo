/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one gate every system notification passes through.
 *
 * Three rules, and all of them are the feature rather than plumbing:
 *
 * - the event's own setting must be the literal `true` (they ship false);
 * - the master switch for THIS device class (`Desktop` / `Mobile`) must not be
 *   `false` — the two switches exist so a phone can stay quiet while a desktop
 *   banners, and vice versa;
 * - the banner is sent in every window state. Focus is not a gate: the user
 *   asked to be told, and the OS decides how to present a banner for the app it
 *   belongs to (the shells install a foreground presentation delegate for
 *   exactly this reason). The sidebar badge stays the in-app record.
 *
 * Text is clipped here because a failure reason can be a whole provider
 * response; an OS notification is a headline, not a log.
 */

import {
  isNotificationEnabled,
  isNotificationPlatformEnabled,
  type NotificationEvent,
} from '@/shared/lib/notifications/settings';
import { showOsNotification } from '@/client/lib/notifications/os';
import { notificationPlatformForClient } from '@/client/lib/notifications/platform';

const TITLE_LIMIT = 120;
const BODY_LIMIT = 240;

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

/** Send a system notification for `event`, unless its setting or platform switch says no. */
export function sendNotification(
  event: NotificationEvent,
  notification: { title: string; body: string; tag?: string; sessionId?: string },
): void {
  if (!isNotificationEnabled(event)) return;
  if (!isNotificationPlatformEnabled(notificationPlatformForClient())) return;
  void showOsNotification({
    title: clip(notification.title, TITLE_LIMIT) || 'Kabmo',
    body: clip(notification.body, BODY_LIMIT),
    tag: notification.tag,
    sessionId: notification.sessionId,
  });
}
