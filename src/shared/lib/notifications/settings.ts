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

/** The two device classes the Notifications page switches delivery for. */
export type NotificationPlatform = 'desktop' | 'mobile';

/** The stored master switch for each platform. */
export const NOTIFICATION_PLATFORM_KEYS: Readonly<Record<NotificationPlatform, string>> = {
  desktop: 'notifyDesktopEnabled',
  mobile: 'notifyMobileEnabled',
};

/**
 * Whether delivery is switched on for `platform`.
 *
 * The masters postdate the event switches, so an install that predates them has
 * no value and must keep sending — an absent key means ON, and only the literal
 * `false` turns a platform off. The event switches remain the opt-in: they ship
 * false and still decide whether a given event is worth a banner.
 */
export function isNotificationPlatformEnabled(
  platform: NotificationPlatform,
  appSettings?: Record<string, any>,
): boolean {
  return readKabmoSetting<boolean>(NOTIFICATION_PLATFORM_KEYS[platform], appSettings) !== false;
}
