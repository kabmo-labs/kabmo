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

export interface OsNotification {
  title: string;
  body: string;
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
 * Ask for notification permission, and report what the platform answered.
 *
 * The shell answers its own permission state; a browser answers its prompt.
 * A refusal is a `false`, never an exception — the caller only needs to know
 * whether notifications can work, not why the OS said no.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  if (hasShellBridge()) {
    try {
      const answer = await callShell<{ granted?: boolean } | null>('notification_request');
      return answer?.granted === true;
    } catch (error) {
      console.warn('[notifications] the shell refused the permission request:', error);
      return false;
    }
  }

  const ctor = browserNotification();
  if (!ctor) return false;
  if (ctor.permission === 'granted') return true;
  if (ctor.permission === 'denied') return false;
  try {
    return (await ctor.requestPermission()) === 'granted';
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
