/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One system notification, through whichever OS the page is running inside.
 *
 * Two transports, one shape:
 *
 * - **A Kabmo shell** (Android, iOS, macOS, Windows, Linux) answers
 *   `notification_show` over the same bridge every other shell command uses.
 *   The shell owns the platform API — a WebView's `Notification` constructor is
 *   unavailable or unanswered on both phones.
 * - **A plain browser** uses the Web Notification API, which is what makes the
 *   feature work outside a shell (desktop Chrome, an installed PWA).
 *
 * Permission is requested only when the user turns a notification setting on
 * (`requestNotificationPermission`), never at boot: the settings default to
 * false, and a permission prompt nobody asked for is exactly what those
 * defaults exist to avoid.
 */

import { callShell, hasShellBridge } from '@/client/lib/shell/transport';
import { openSessionInUrl } from '@/client/lib/router/open-session';
import type { NotificationKind } from '@/shared/lib/notifications/events';

export interface OsNotification {
  title: string;
  body: string;
  /**
   * Which event this is. The shells play a different chime for `ask` (the
   * console's "the agent is blocked on you" cue) than for `finish`/`error`; a
   * browser's own notification has no sound slot, so it is ignored there.
   */
  kind: NotificationKind;
  /** Replaces an earlier notification for the same thing (a session, a run). */
  tag?: string;
  /** The session a click opens, when the event is about one. */
  sessionId?: string;
  /**
   * The event's own moment, epoch milliseconds — what the shade's timestamp
   * names. A banner delivered when the app is next opened must not claim it just
   * happened, so this travels instead of letting the platform stamp "now".
   */
  at?: number;
  /** How long the run took, when the server knew its start. */
  durationMs?: number;
}

/** The browser's constructor, absent on iOS WebViews and in tests. */
type NotificationConstructor = typeof Notification;

function browserNotification(): NotificationConstructor | null {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;
  const ctor = window.Notification;
  return typeof ctor === 'function' ? ctor : null;
}

/**
 * The platform's grant for this device.
 *
 * `unknown` is the honest default: a shell with no permission model (Windows,
 * Linux) or an older build that does not answer `notification_state` has not
 * refused anything, and guessing would either silence the page's own chime or
 * show a warning the user cannot act on.
 */
export type NotificationPermission = 'granted' | 'denied' | 'notDetermined' | 'unknown';

/** The grant, and whether this platform has a screen where it can be changed. */
export interface NotificationGrant {
  status: NotificationPermission;
  canOpenSettings: boolean;
}

/**
 * The last grant the platform reported.
 *
 * Cached because the sound decision is synchronous: `nativeBannerPlaysSound`
 * runs inside the event callback, and a denied grant means the shell posts a
 * banner the platform drops — so the page must keep its own chime instead of
 * handing the sound to a banner nobody sees.
 */
let permission: NotificationPermission = 'unknown';

/** The last grant the platform reported, or `unknown` before the first read. */
export function notificationPermission(): NotificationPermission {
  return permission;
}

function remember(status: NotificationPermission): NotificationPermission {
  permission = status;
  return status;
}

function asPermission(value: unknown): NotificationPermission {
  return value === 'granted' || value === 'denied' || value === 'notDetermined'
    ? value
    : 'unknown';
}

function browserPermission(ctor: NotificationConstructor): NotificationPermission {
  if (ctor.permission === 'granted') return 'granted';
  if (ctor.permission === 'denied') return 'denied';
  return 'notDetermined';
}

/**
 * Read the platform's grant WITHOUT asking for it.
 *
 * The settings page calls this on mount and on focus, so a grant the user
 * changed in the system settings is picked up when they come back. A shell that
 * does not answer the command is `unknown`, not a refusal.
 */
export async function readNotificationGrant(): Promise<NotificationGrant> {
  if (typeof window === 'undefined') return { status: remember('unknown'), canOpenSettings: false };

  if (!hasShellBridge()) {
    const ctor = browserNotification();
    return {
      status: remember(ctor ? browserPermission(ctor) : 'unknown'),
      canOpenSettings: false,
    };
  }

  try {
    const answer = await callShell<{ status?: unknown; canOpenSettings?: unknown } | null>(
      'notification_state',
    );
    return {
      status: remember(asPermission(answer?.status)),
      canOpenSettings: answer?.canOpenSettings === true,
    };
  } catch {
    // An older shell does not know the command. That is not a refusal, and the
    // pre-existing behaviour (the shell owns the chime) must survive it.
    return { status: remember('unknown'), canOpenSettings: false };
  }
}

/**
 * Open the screen where this app's grant lives.
 *
 * A browser has no such screen to deep-link, so it answers `false` and the
 * caller keeps its written instructions. A shell refusal is reported, because
 * the button exists to fix a denial and a dead button is worse than none.
 */
export async function openNotificationSettings(): Promise<boolean> {
  if (typeof window === 'undefined' || !hasShellBridge()) return false;
  try {
    await callShell('notification_settings_open');
    return true;
  } catch (error) {
    console.warn('[notifications] the shell could not open the system settings:', error);
    return false;
  }
}

/**
 * Ask for notification permission, and report what the platform answered.
 *
 * The shell answers its own permission state; a browser answers its prompt.
 * A refusal is a `false`, never an exception — the caller only needs to know
 * whether notifications can work, not why the OS said no. The answer is also
 * remembered, because the sound decision reads it synchronously.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (hasShellBridge()) {
    try {
      const answer = await callShell<{ granted?: boolean } | null>('notification_request');
      const granted = answer?.granted === true;
      remember(granted ? 'granted' : 'denied');
      return granted;
    } catch (error) {
      // The command itself failed (an older shell), which says nothing about
      // the grant — so the cached answer is left alone.
      console.warn('[notifications] the shell refused the permission request:', error);
      return false;
    }
  }

  const ctor = browserNotification();
  if (!ctor) return false;
  if (ctor.permission === 'granted') {
    remember('granted');
    return true;
  }
  if (ctor.permission === 'denied') {
    remember('denied');
    return false;
  }
  try {
    const granted = (await ctor.requestPermission()) === 'granted';
    remember(granted ? 'granted' : 'denied');
    return granted;
  } catch {
    return false;
  }
}

/** Send one system notification, or drop it when the platform cannot. */
export async function showOsNotification(notification: OsNotification): Promise<void> {
  if (typeof window === 'undefined') return;

  if (hasShellBridge()) {
    try {
      await callShell('notification_show', {
        title: notification.title,
        body: notification.body,
        kind: notification.kind,
        ...(notification.tag ? { tag: notification.tag } : {}),
        ...(notification.sessionId ? { sessionId: notification.sessionId } : {}),
        // The shells render what they can: Android puts `when` on the shade's
        // clock and the duration in its subtext line, and the others ignore
        // fields they have no slot for.
        ...(notification.at ? { when: String(notification.at) } : {}),
        ...(notification.durationMs ? { durationMs: String(notification.durationMs) } : {}),
      });
    } catch (error) {
      // A refused notification is not a failed run: the in-app badge is still
      // the record. Report it once instead of disturbing the user with a toast
      // about the toast.
      console.warn('[notifications] the shell could not show a notification:', error);
    }
    return;
  }

  const ctor = browserNotification();
  if (!ctor || ctor.permission !== 'granted') return;
  try {
    const shown = new ctor(notification.title, {
      body: notification.body,
      ...(notification.tag ? { tag: notification.tag } : {}),
      // The browser has a native timestamp; it has no duration slot, so the
      // duration is not shown rather than being crammed into the body.
      ...(notification.at ? { timestamp: notification.at } : {}),
    });
    // A browser notification has no shell to route a click, so the click opens
    // the session here. `focus()` first: a tab that stays in the background
    // would change its URL while the user is looking at another window.
    shown.onclick = () => {
      if (typeof window.focus === 'function') window.focus();
      if (notification.sessionId) openSessionInUrl(notification.sessionId);
      shown.close();
    };
  } catch (error) {
    console.warn('[notifications] the browser could not show a notification:', error);
  }
}
