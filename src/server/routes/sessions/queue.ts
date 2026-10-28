/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-item follow-up queue routes (`queued_messages` table). The client panel
 * is a VIEW: every mutation goes through one of these endpoints and returns
 * the canonical queue, so the client never ships a full-list replacement
 * (that shape is what let a reload wipe the table and a session switch copy
 * one session's queue into another).
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { requireParam } from '@/server/lib/route-adapter';
import {
  appendQueueItem,
  deleteQueueItem,
  listQueue,
  patchQueueItem,
  reorderQueue,
} from '@/server/lib/queue/store.server';
import { getRpcSession } from '@/server/lib/omp/rpc/manager';
import { deliverQueueNow } from '@/server/lib/queue/delivery.server';

/** GET — the session's queued follow-ups in delivery order. */
export async function getQueue({ params }: LoaderFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  return json({ queue: await listQueue(sessionId) });
}

/**
 * POST — append one queued item. Body: `{ text, attachments?, model? }`.
 * Returns the canonical queue.
 */
export async function addQueueItem({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.text !== 'string' || (!body.text.trim() && !Array.isArray(body.attachments))) {
    return json({ error: 'Invalid body: expected { text: string, attachments?, model? }' }, { status: 400 });
  }
  const queue = await appendQueueItem(sessionId, {
    text: body.text,
    attachments: body.attachments,
    model: body.model,
  });
  return json({ queue });
}

/**
 * PATCH — edit one item's text and/or model snapshot. Body: `{ text?, model? }`.
 * Returns the canonical queue; 404 when the id is unknown or already claimed.
 */
export async function editQueueItem({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  if (request.method !== 'PATCH') return json({ error: 'Method not allowed' }, { status: 405 });

  const itemId = params.itemId;
  if (!itemId) return json({ error: 'Item ID is required' }, { status: 400 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return json({ error: 'Invalid JSON body' }, { status: 400 });

  const queue = await patchQueueItem(sessionId, itemId, { text: body.text, model: body.model });
  if (!queue) return json({ error: 'Queue item not found' }, { status: 404 });
  return json({ queue });
}

/**
 * DELETE — remove one item by id. 404 when it was already claimed for
 * delivery or never existed (both leave nothing to remove).
 */
export async function removeQueueItem({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  if (request.method !== 'DELETE') return json({ error: 'Method not allowed' }, { status: 405 });

  const itemId = params.itemId;
  if (!itemId) return json({ error: 'Item ID is required' }, { status: 400 });
  const removed = await deleteQueueItem(sessionId, itemId);
  if (!removed) return json({ error: 'Queue item not found' }, { status: 404 });
  return json({ success: true });
}

/**
 * PUT — reorder the queue to exactly `{ orderedIds: string[] }` (a drag in the
 * panel ships ids only, never item payloads). Returns the canonical queue.
 */
export async function reorderQueueItems({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, { status: 405 });

  const body = (await request.json().catch(() => null)) as { orderedIds?: unknown } | null;
  if (!body || !Array.isArray(body.orderedIds) || body.orderedIds.some((id) => typeof id !== 'string')) {
    return json({ error: 'Invalid body: expected { orderedIds: string[] }' }, { status: 400 });
  }
  return json({ queue: await reorderQueue(sessionId, body.orderedIds) });
}

/**
 * POST /queue/deliver — client nudge: a tab that (re)opens a session offers
 * the server a delivery slot. The server-side claim makes this a no-op when a
 * run is active or the head was already claimed; an idle session with queued
 * items gets its head delivered exactly once.
 *
 * The attempt runs IMMEDIATELY rather than arming the usual settle timer. This
 * is the recovery path, and the failure it recovers from is a lost timer — a
 * long-lived `--hot` dev server whose `setTimeout` callbacks stop firing leaves
 * `scheduleQueueDelivery` scheduling into the void, so a nudge that merely
 * re-armed another timer would fail exactly like the delivery it was meant to
 * rescue. The 500ms settle exists to let omp's own turn-end bookkeeping finish;
 * by the time a client nudges, that window has long passed.
 *
 * The response carries the CANONICAL queue, so a client polling this as a
 * safety net gets its panel reconciled in the same round trip.
 */
export async function nudgeQueueDelivery({ request, params }: ActionFunctionArgs) {
  const sessionId = requireParam(params, 'sessionId');
  if (!sessionId) return json({ error: 'Session ID is required' }, { status: 400 });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const session = getRpcSession(sessionId);
  if (!session?.isAlive()) {
    return json({ success: true, delivered: false, reason: 'session-not-live', queue: await listQueue(sessionId) });
  }
  const delivered = await deliverQueueNow(session);
  return json({ success: true, delivered, queue: await listQueue(sessionId) });
}
