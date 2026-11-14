/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * App-wide system notifications, as the SERVER decided them.
 *
 * The events arrive on the realtime `notifications` topic, one frame per event.
 * This hook used to do the deciding itself, by diffing consecutive
 * `sidebar:status` snapshots for a `stream → finish` transition — and that is
 * exactly what broke on Android: a backgrounded WebView is frozen, so it sees
 * no transition, and the snapshot it finally receives on resume carried the
 * whole backlog, which fired every banner at once. A page that never had to
 * infer the event cannot replay one.
 *
 * Two gates remain, and they are the client's own:
 *
 * - the platform master (`notifyMobileEnabled` / `notifyDesktopEnabled`),
 *   because only this side knows its device class;
 * - the delivery path itself — a shell's bridge, or the browser's `Notification`
 *   API outside one.
 *
 * The event switches (`notifyOnFinish` / `notifyOnAsk` / `notifyOnError`) are
 * applied by the server before an event is recorded, so a silenced event never
 * reaches this hook at all.
 */

import { useEffect } from 'preact/hooks';
import { realtimeClient } from '@/shared/lib/realtime/client';
import { TOPIC_NOTIFICATIONS } from '@/shared/lib/realtime/protocol';
import { isNotificationPlatformEnabled } from '@/shared/lib/notifications/settings';
import { asNotificationEvent, notificationTag } from '@/shared/lib/notifications/events';
import { showOsNotification } from '@/client/lib/notifications/os';
import { notificationPlatformForClient } from '@/client/lib/notifications/platform';
import { triggerInputRequiredSound } from '@/client/hooks/ui/notification-sound';

export function useNotificationEvents(): void {
  useEffect(
    () =>
      realtimeClient.subscribeFrames(TOPIC_NOTIFICATIONS, (frame) => {
        // A snapshot is the empty baseline (or a resync after a gap) — never news.
        if (frame.kind !== 'delta') return;
        const event = asNotificationEvent(frame.payload);
        if (!event) return;
        // The chime is its own preference and plays for an ask regardless of
        // whether this device is allowed a system banner.
        if (event.kind === 'ask') triggerInputRequiredSound();
        if (!isNotificationPlatformEnabled(notificationPlatformForClient())) return;
        void showOsNotification({
          title: event.title,
          body: event.body,
          tag: notificationTag(event),
          sessionId: event.sessionId,
        });
      }),
    [],
  );
}
