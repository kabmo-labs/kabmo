/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/notifications/stream` — the notification outbox as Server-Sent
 * Events, for a consumer that is not a page.
 *
 * The Android shell's watcher holds this stream while the console is closed, so
 * a banner arrives when the run ends instead of when the app is next opened.
 * The page does not use it: an open page already has the realtime socket, and a
 * second connection per tab is exactly what that socket exists to avoid.
 *
 * ## The cursor
 *
 * `after=<id>` resumes from the last event the consumer saw. A consumer with no
 * cursor yet (a first run, a cleared app) sends none, and is answered with a
 * `cursor` frame carrying the newest id — NOT the backlog. Replaying history to
 * a fresh consumer is the "all the notifications at once" failure this endpoint
 * exists to remove, so the prime is explicit and the backlog is only ever sent
 * to a consumer that named a cursor.
 *
 * ## The platform master
 *
 * `platform=mobile|desktop` selects which delivery master applies. A silenced
 * platform keeps its stream open (heartbeats only) rather than being refused:
 * the setting can be flipped from another device, and a refused stream would
 * make the watcher reconnect forever.
 */

import { createSseStream } from '@/server/lib/sse';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { getDb } from '@/server/db.server';
import { readAllSettingsJson } from '@/server/lib/db/settings-store';
import { NOTIFICATION_PLATFORM_KEYS, type NotificationPlatform } from '@/shared/lib/notifications/settings';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { onNotificationEvent } from '@/server/lib/notifications/feed.server';
import {
  latestNotificationEventId,
  listNotificationEventsAfter,
} from '@/server/lib/notifications/store.server';

/** Long enough that a phone's radio sleeps between beats, short enough to notice a dead link. */
const HEARTBEAT_MS = 25_000;

async function platformEnabled(platform: NotificationPlatform): Promise<boolean> {
  try {
    const db = await getDb();
    const rows = await readAllSettingsJson(db);
    const settings = { ...rows, ...readSettingsBlob(rows as Record<string, unknown>) };
    // The master postdates the feature, so an absent key means ON; only the
    // literal `false` silences a platform.
    return settings[NOTIFICATION_PLATFORM_KEYS[platform]] !== false;
  } catch {
    // An unreadable settings row must not silence a stream that is otherwise fine.
    return true;
  }
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const rawAfter = url.searchParams.get('after');
  const after = rawAfter === null ? null : Number(rawAfter);
  const platform: NotificationPlatform = url.searchParams.get('platform') === 'mobile' ? 'mobile' : 'desktop';

  const stream = createSseStream({
    heartbeatMs: HEARTBEAT_MS,
    signal: request.signal,
    headers: { 'Cache-Control': 'no-cache, no-transform' },
    async onStart(handlers) {
      if (!(await platformEnabled(platform))) {
        handlers.send('disabled', { platform });
        return;
      }
      if (after === null || !Number.isFinite(after)) {
        handlers.send('cursor', { id: await latestNotificationEventId() });
      } else {
        for (const event of await listNotificationEventsAfter(after)) {
          handlers.send('notification', event);
        }
      }
      return onNotificationEvent((event) => handlers.send('notification', event));
    },
  });

  return stream.response;
}
