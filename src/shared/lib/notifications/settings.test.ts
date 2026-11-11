/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/** The notification preferences are opt-in, and only the boolean `true` opts in. */

import { afterEach, describe, expect, test } from 'bun:test';

import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { DEFAULT_SETTINGS } from '@/shared/lib/settings/defaults';
import {
  isNotificationEnabled,
  isNotificationPlatformEnabled,
  NOTIFICATION_PLATFORM_KEYS,
  NOTIFICATION_SETTING_KEYS,
  type NotificationEvent,
  type NotificationPlatform,
} from '@/shared/lib/notifications/settings';

const EVENTS: NotificationEvent[] = ['finish', 'ask', 'error'];
const PLATFORMS: NotificationPlatform[] = ['desktop', 'mobile'];

afterEach(() => {
  primeKabmoSettings({});
});

describe('notification settings', () => {
  test('every event is off on a fresh install', () => {
    primeKabmoSettings({});
    for (const event of EVENTS) expect(isNotificationEnabled(event)).toBe(false);
  });

  test('the shipped defaults are all false', () => {
    // The defaults object is what the settings modal seeds from, so a `true`
    // here would silently turn notifications on for a new install.
    for (const event of EVENTS) {
      expect(DEFAULT_SETTINGS[NOTIFICATION_SETTING_KEYS[event] as keyof typeof DEFAULT_SETTINGS]).toBe(false);
    }
  });

  test('each event reads its own key', () => {
    primeKabmoSettings({ notifyOnFinish: true, notifyOnAsk: false, notifyOnError: true });
    expect(isNotificationEnabled('finish')).toBe(true);
    expect(isNotificationEnabled('ask')).toBe(false);
    expect(isNotificationEnabled('error')).toBe(true);
  });

  test('a truthy non-boolean does not opt in', () => {
    primeKabmoSettings({ notifyOnFinish: 'yes' });
    expect(isNotificationEnabled('finish')).toBe(false);
  });

  test('both platform switches ship ON, so the event opt-ins keep working', () => {
    for (const platform of PLATFORMS) {
      expect(DEFAULT_SETTINGS[NOTIFICATION_PLATFORM_KEYS[platform] as keyof typeof DEFAULT_SETTINGS]).toBe(true);
    }
  });

  test('an install that predates the master keys still delivers', () => {
    primeKabmoSettings({});
    for (const platform of PLATFORMS) expect(isNotificationPlatformEnabled(platform)).toBe(true);
  });

  test('only the literal false silences a platform', () => {
    primeKabmoSettings({ notifyDesktopEnabled: false, notifyMobileEnabled: true });
    expect(isNotificationPlatformEnabled('desktop')).toBe(false);
    expect(isNotificationPlatformEnabled('mobile')).toBe(true);
  });
});
