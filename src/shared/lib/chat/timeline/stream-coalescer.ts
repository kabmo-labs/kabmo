/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Frame coalescer for the live agent stream.
 *
 * omp emits one `message_update` per model chunk, each carrying that message's
 * FULL accumulated content, so a burst only needs the newest payload per
 * message id. This batches at most one commit per animation frame; the terminal
 * frame flushes synchronously first so the last chunk is never dropped.
 *
 * The sink is a module-level singleton bound once per callbacks factory run
 * (`bindStreamingCoalescer`), because that factory re-runs on every render
 * while the batch's scheduled frame must survive across renders. Split out of
 * omp-callbacks.ts so that file stays under the repo's per-file size ceiling.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { ChatMessageData } from '@/shared/types';
import { createRafBatch } from '@/shared/lib/chat/timeline/stream-raf';

let applyMessageUpdater: Dispatch<SetStateAction<ChatMessageData[]>> = () => {};
let scrollAfterFlush: () => void = () => {};

const messageBatch = createRafBatch<ChatMessageData[]>(
  updater => applyMessageUpdater(updater),
  () => scrollAfterFlush(),
);

/** Point the batch at the current render's state setter and scroll hook. */
export function bindStreamingCoalescer(
  apply: Dispatch<SetStateAction<ChatMessageData[]>>,
  afterFlush: () => void,
): void {
  applyMessageUpdater = apply;
  scrollAfterFlush = afterFlush;
}

/** Queue a coalesced update for the next animation frame, keyed per message. */
export function queueStreamingUpdate(
  updater: (prev: ChatMessageData[]) => ChatMessageData[],
  key: string,
): void {
  messageBatch.queue(updater, key);
}

/** Apply any queued update synchronously (terminal frames call this first so
 *  the last chunk is never dropped). */
export function flushStreamingUpdates(): void {
  messageBatch.flush();
}

/** Apply any coalesced update, then invalidate its scheduled frame. */
export function disposeStreamingCoalescer(): void {
  messageBatch.flush();
  messageBatch.cancel();
}

/** Drop coalesced updates without applying them — a session switch discards
 *  the previous session's queued `message_update` frames so they cannot leak
 *  into the freshly cleared timeline of the next session. */
export function cancelStreamingCoalescer(): void {
  messageBatch.cancel();
}
