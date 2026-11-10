/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one gate every system notification passes through.
 *
 * Two rules, and both are the feature rather than plumbing:
 *
 * - the event's own setting must be the literal `true` (they ship false);
 * - the page must not be the window the user is looking at. The sidebar badge,
 *   the ask card and the inline error row already report these events on
 *   screen, so a banner over the app would only repeat what is visible.
 *
 * Text is clipped here because a failure reason can be a whole provider
 * response; an OS notification is a headline, not a log.
 */

import { isNotificationEnabled, type NotificationEvent } from '@/shared/lib/notifications/settings';
import { showOsNotification, shouldShowSystemNotification } from '@/client/lib/notifications/os';

const TITLE_LIMIT = 120;
const BODY_LIMIT = 240;

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

/** Send a system notification for `event`, unless the setting or focus says no. */
export function sendNotification(
  event: NotificationEvent,
  notification: { title: string; body: string; tag?: string; sessionId?: string },
): void {
  if (!isNotificationEnabled(event)) return;
  if (!shouldShowSystemNotification()) return;
  void showOsNotification({
    title: clip(notification.title, TITLE_LIMIT) || 'Kabmo',
    body: clip(notification.body, BODY_LIMIT),
    tag: notification.tag,
    sessionId: notification.sessionId,
  });
}
