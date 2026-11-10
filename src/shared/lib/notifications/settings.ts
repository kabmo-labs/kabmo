/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which system notification each event is allowed to send.
 *
 * All three default to FALSE, and only the literal `true` enables one. That
 * strictness is the feature: an install that predates these keys has no value
 * at all, and a truthy string from a hand-edited settings blob must not opt the
 * user into OS notifications they never chose. It also keeps a fresh install
 * from being prompted for permission by a shell on first launch.
 */

import { readKabmoSetting } from '@/shared/lib/settings/client';

/** The events a notification setting exists for. */
export type NotificationEvent = 'finish' | 'ask' | 'error';

/** The stored setting key for each event. */
export const NOTIFICATION_SETTING_KEYS: Readonly<Record<NotificationEvent, string>> = {
  finish: 'notifyOnFinish',
  ask: 'notifyOnAsk',
  error: 'notifyOnError',
};

/** Whether the user asked for a system notification for `event`. */
export function isNotificationEnabled(
  event: NotificationEvent,
  appSettings?: Record<string, any>,
): boolean {
  return readKabmoSetting<boolean>(NOTIFICATION_SETTING_KEYS[event], appSettings) === true;
}
