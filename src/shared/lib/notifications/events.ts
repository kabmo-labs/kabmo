/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One system-notification event, on the wire between the server and whichever
 * consumer posts it.
 *
 * Shared by both ends for the same reason the realtime frames are: the server
 * records it, the browser page reads it off the realtime topic, and the Android
 * watcher parses the same shape out of its SSE stream. Three readers, one
 * definition — a field renamed on one side is otherwise a silently empty banner.
 *
 * `id` is a monotonic cursor: a consumer resumes from the last id it saw, which
 * is what makes "never announce a backlog twice" a property of the transport
 * rather than a rule every consumer has to remember.
 */

export type NotificationKind = 'finish' | 'error' | 'ask';

export interface NotificationEvent {
  id: number;
  kind: NotificationKind;
  sessionId: string;
  /** The banner's title: the session's name at the moment the run settled. */
  title: string;
  /** The body: the failure reason, or the event's own sentence. */
  body: string;
  /** Epoch milliseconds. */
  at: number;
}

/** The stable notification tag: one banner per session per kind, replaced. */
export function notificationTag(event: Pick<NotificationEvent, 'kind' | 'sessionId'>): string {
  return `${event.kind}:${event.sessionId}`;
}

/**
 * One event from a realtime frame's payload, or null.
 *
 * The guard is shared rather than living in the hook so the wire shape has one
 * definition: a payload missing an id could not advance a cursor, and one
 * missing a session could not open anything on a tap — both are refused here
 * instead of posting a banner that names nothing.
 */
export function asNotificationEvent(payload: unknown): NotificationEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<NotificationEvent>;
  if (typeof candidate.id !== 'number' || typeof candidate.sessionId !== 'string') return null;
  if (candidate.kind !== 'finish' && candidate.kind !== 'error' && candidate.kind !== 'ask') return null;
  return {
    id: candidate.id,
    kind: candidate.kind,
    sessionId: candidate.sessionId,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    body: typeof candidate.body === 'string' ? candidate.body : '',
    at: typeof candidate.at === 'number' ? candidate.at : 0,
  };
}
