/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE place a system notification is decided.
 *
 * Three events are news — a run finished, a run failed, an agent is blocked on
 * an answer — and each is a transition the SERVER sees. Deciding them here
 * (rather than in the page, which is what the first implementation did) is what
 * makes a banner arrive while the console is closed: a backgrounded Android
 * WebView is frozen, so it observes nothing, and it used to announce the whole
 * backlog the moment the app was resumed.
 *
 * Fan-out has two consumers and one source: the realtime hub topic
 * (`notifications`) for a page that is open, and `GET /api/notifications/stream`
 * for the Android shell's watcher, which keeps running with no page alive. The
 * event switch preferences are applied HERE, because they are the same for both;
 * the per-device delivery master (`notifyDesktopEnabled` / `notifyMobileEnabled`)
 * is applied by the consumer, which is the only side that knows its device class.
 *
 * Everything is best-effort. A settle hook that failed to record an event must
 * never turn a finished run into a failed one.
 */

import { getDb } from '@/server/db.server';
import { readAllSettingsJson } from '@/server/lib/db/settings-store';
import { getRealtimeHub } from '@/server/lib/realtime/hub.server';
import { TOPIC_NOTIFICATIONS } from '@/shared/lib/realtime/protocol';
import {
  NOTIFICATION_SETTING_KEYS,
  type NotificationEvent as NotificationEventKey,
} from '@/shared/lib/notifications/settings';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { sessionTitleFor } from '@/shared/lib/omp/session/sidebar';
import { loadOmpSidebarData } from '@/server/lib/omp/session/reader';
import { loadHarnessSessionTitle } from '@/server/lib/harness/session-store.server';
import { appendNotificationEvent } from '@/server/lib/notifications/store.server';
import { notificationText, type NotificationEvent, type NotificationKind } from '@/shared/lib/notifications/events';

/** Bounds on the stored text: a failure reason can be a whole provider body. */
const TITLE_LIMIT = 120;
const BODY_LIMIT = 600;

/** Listeners the SSE route attaches; one set per process. */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoNotificationListeners: Set<(event: NotificationEvent) => void> | undefined;
}

function listeners(): Set<(event: NotificationEvent) => void> {
  globalThis.__kabmoNotificationListeners ??= new Set();
  return globalThis.__kabmoNotificationListeners;
}

/** Observe every event recorded from now on. Returns the unsubscribe. */
export function onNotificationEvent(listener: (event: NotificationEvent) => void): () => void {
  const set = listeners();
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function clip(text: string, limit: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * The session's own name, for the banner's title.
 *
 * Two row sources, one precedence: an ACP chat's stored title, else the omp
 * session the JSONL scan knows about, else the app name. The scan is TTL-cached
 * (it is the same one the sidebar reads), so a run settle does not pay for it
 * twice.
 */
async function resolveTitle(sessionId: string): Promise<string> {
  try {
    const stored = (await loadHarnessSessionTitle(sessionId)).trim();
    if (stored) return clip(stored, TITLE_LIMIT);
  } catch {
    // No harness row is the common case for an omp session.
  }
  try {
    const data = await loadOmpSidebarData();
    const session = data.sessions.find((entry) => entry.id === sessionId);
    if (session) return clip(sessionTitleFor(session), TITLE_LIMIT);
  } catch {
    // A scan failure still leaves a usable banner.
  }
  return 'Kabmo';
}

/**
 * The event switches, read from the persisted settings the page writes.
 *
 * The blob is merged here rather than through the client's settings snapshot:
 * the server has no page to have primed one, and this read must always reflect
 * the row as stored — the same reason a stream cannot cache it.
 */
async function enabledEvents(): Promise<Set<NotificationEventKey>> {
  const enabled = new Set<NotificationEventKey>();
  try {
    const db = await getDb();
    const rows = await readAllSettingsJson(db);
    const settings = { ...rows, ...readSettingsBlob(rows as Record<string, unknown>) };
    for (const event of ['finish', 'error', 'ask'] as const) {
      // Only the literal `true` opts in, exactly as the client's reader insists.
      if (settings[NOTIFICATION_SETTING_KEYS[event]] === true) enabled.add(event);
    }
  } catch {
    // An unreadable settings row means no event was opted into.
  }
  return enabled;
}

/**
 * Record one event, publish it, and return it — or null when the event's own
 * switch is off (the shipped default).
 */
async function record(
  event: NotificationEventKey,
  input: {
    title: string;
    body: string;
    sessionId: string;
    kind: NotificationKind;
    durationMs?: number;
  },
): Promise<NotificationEvent | null> {
  const enabled = await enabledEvents();
  if (!enabled.has(event)) return null;
  // Sanitised BEFORE clipping, so the limit counts characters a banner can
  // actually draw — a title made of Nerd Font icons would otherwise spend its
  // whole budget on glyphs the shade renders as tofu.
  const stored = await appendNotificationEvent({
    kind: input.kind,
    sessionId: input.sessionId,
    title: clip(notificationText(input.title), TITLE_LIMIT) || 'Kabmo',
    body: clip(notificationText(input.body), BODY_LIMIT),
    ...(input.durationMs && input.durationMs > 0 ? { durationMs: input.durationMs } : {}),
  });
  getRealtimeHub().publish(TOPIC_NOTIFICATIONS, stored);
  for (const listener of [...listeners()]) {
    try {
      listener(stored);
    } catch {
      // One broken consumer must not starve the others.
    }
  }
  return stored;
}

/**
 * A run settled. `failure` is the agent's own reason, which is what makes the
 * difference between "finished" and "failed" — and the failure reason is the
 * whole body of the error banner.
 */
export async function noteRunSettled(
  sessionId: string,
  failure: string | null,
  durationMs?: number | null,
): Promise<void> {
  if (!sessionId) return;
  try {
    const reason = (failure ?? '').trim();
    await record(reason ? 'error' : 'finish', {
      kind: reason ? 'error' : 'finish',
      sessionId,
      title: await resolveTitle(sessionId),
      body: reason || 'The run finished.',
      ...(typeof durationMs === 'number' && durationMs > 0 ? { durationMs } : {}),
    });
  } catch (error) {
    console.warn('[notifications] could not record a run outcome:', error);
  }
}

/** An agent parked a dialog nobody has answered yet. */
export async function noteAwaitingInput(sessionId: string): Promise<void> {
  if (!sessionId) return;
  try {
    await record('ask', {
      kind: 'ask',
      sessionId,
      title: await resolveTitle(sessionId),
      body: 'Waiting for your answer.',
    });
  } catch (error) {
    console.warn('[notifications] could not record an awaiting-input event:', error);
  }
}
