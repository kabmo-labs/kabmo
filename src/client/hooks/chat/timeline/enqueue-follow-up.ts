/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Snapshot a follow-up onto the server-backed queue.
 *
 * The composer's model/thinking pick plus the live access mode ride along, so
 * auto-delivery replays exactly these settings instead of whatever the session
 * happens to run with at delivery time. The queue row is JSON — a live `File`
 * does not survive it — so text contents and display fields are captured HERE,
 * while the handle still exists.
 */

import type { Attachment, QueuedMessage, QueuedMessageModel } from '@/shared/types/chat';
import { prepareQueuedAttachments } from '@/shared/lib/chat/attachments';

export interface FollowUpSnapshotDeps {
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  accessModeRef: { current: string };
  enqueueMessage: (item: Omit<QueuedMessage, 'id'>) => void;
}

export function enqueuePreparedFollowUp(
  deps: FollowUpSnapshotDeps,
  text: string,
  attachments: Attachment[],
): void {
  const composerPick = deps.composerModelRef.current;
  const model: QueuedMessageModel | null = composerPick
    ? { ...composerPick, accessMode: deps.accessModeRef.current as QueuedMessageModel['accessMode'] }
    : null;
  void prepareQueuedAttachments(attachments).then((prepared) => {
    deps.enqueueMessage({ text, attachments: prepared, model });
  });
}
