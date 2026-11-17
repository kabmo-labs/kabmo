/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one rule that removes the double chime: a shell's banner plays the Kabmo
 * sound itself, so the page must not play the cue on top of it.
 *
 * Every branch here is a sound the user either hears twice or never — neither
 * throws, neither logs, so this is the only place the decision is visible.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { nativeBannerPlaysSound } from '@/client/lib/notifications/native-banner-sound';
import { readNotificationGrant } from '@/client/lib/notifications/os';
import { notificationPlatformForClient } from '@/client/lib/notifications/platform';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = ['window', 'document', 'navigator'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(async () => {
  primeKabmoSettings({});
  delete window.__kabmoCall;
  // The grant is module state; a browser read puts it back to `unknown`.
  await readNotificationGrant();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

/** A shell that answers everything, so `hasShellBridge()` is true. */
function installShell(): void {
  window.__kabmoCall = () => Promise.resolve(null);
}

/** Record the grant the platform reports, through the real reader. */
async function grant(status: string): Promise<void> {
  window.__kabmoCall = (method) =>
    Promise.resolve(method === 'notification_state' ? { status, canOpenSettings: true } : null);
  await readNotificationGrant();
}

describe('nativeBannerPlaysSound', () => {
  test('a browser keeps the Web Audio cue', () => {
    primeKabmoSettings({ notifyOnFinish: true, notifyOnAsk: true });
    expect(nativeBannerPlaysSound('finish')).toBe(false);
  });

  test('a shell with the event switch on owns the sound', () => {
    installShell();
    primeKabmoSettings({ notifyOnFinish: true });
    expect(nativeBannerPlaysSound('finish')).toBe(true);
  });

  test('the event switch ships off, so the page stays audible', () => {
    installShell();
    primeKabmoSettings({});
    expect(nativeBannerPlaysSound('finish')).toBe(false);
    expect(nativeBannerPlaysSound('ask')).toBe(false);
    expect(nativeBannerPlaysSound('error')).toBe(false);
  });

  test('a silenced device class falls back to the page cue', () => {
    installShell();
    const master = notificationPlatformForClient() === 'mobile'
      ? 'notifyMobileEnabled'
      : 'notifyDesktopEnabled';
    primeKabmoSettings({ notifyOnFinish: true, [master]: false });
    expect(nativeBannerPlaysSound('finish')).toBe(false);
  });

  test('the other device class does not silence this one', () => {
    installShell();
    const other = notificationPlatformForClient() === 'mobile'
      ? 'notifyDesktopEnabled'
      : 'notifyMobileEnabled';
    primeKabmoSettings({ notifyOnAsk: true, [other]: false });
    expect(nativeBannerPlaysSound('ask')).toBe(true);
  });

  test('each event is gated by its own switch', () => {
    installShell();
    primeKabmoSettings({ notifyOnAsk: true });
    expect(nativeBannerPlaysSound('ask')).toBe(true);
    expect(nativeBannerPlaysSound('finish')).toBe(false);
    expect(nativeBannerPlaysSound('error')).toBe(false);
  });

  test('a denied grant keeps the page cue, because the banner is dropped', async () => {
    installShell();
    primeKabmoSettings({ notifyOnFinish: true });
    await grant('denied');
    // The shell still posts, but the platform drops the banner AND its sound —
    // so handing the chime to it is the silence this rule exists to prevent.
    expect(nativeBannerPlaysSound('finish')).toBe(false);
  });

  test('a granted grant hands the sound to the banner', async () => {
    installShell();
    primeKabmoSettings({ notifyOnFinish: true });
    await grant('granted');
    expect(nativeBannerPlaysSound('finish')).toBe(true);
  });

  test('an unknown grant keeps the previous behaviour', async () => {
    installShell();
    primeKabmoSettings({ notifyOnFinish: true });
    await grant('unknown');
    expect(nativeBannerPlaysSound('finish')).toBe(true);
  });
});
