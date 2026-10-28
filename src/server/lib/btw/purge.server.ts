/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Deleting a session's side questions.
 *
 * A side question is keyed to the parent session but stored outside it — rows
 * in `btw_topics`/`btw_turns`, a live omp child per topic, and a private
 * transcript directory under `<db dir>/btw/<sessionId>/<topicId>/`. Deleting
 * the chat session therefore leaves all three behind unless they are purged
 * with it: orphan turns still readable in the database, and on disk a full
 * copy of the very transcript the user just deleted.
 *
 * Kept out of `service.server.ts` (which owns the interactive topic
 * operations) so that file's growth stays attributable.
 */

import path from 'path';
import { listBtwTopics, deleteBtwTopic } from '@/server/lib/btw/store.server';
import { forgetBtwRuntime, getBtwRuntime } from '@/server/lib/btw/registry.server';
import { getBtwRoot, removeBtwWorkspace, resolveBtwWorkspacePaths } from '@/server/lib/btw/session-copy.server';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';

/**
 * Drop every topic of `sessionId`, its child, its rows, and its workspace.
 *
 * `sessionId` MUST name one child of the btw root. The last step below removes
 * `join(getBtwRoot(), sessionId)` unconditionally, and `join(root, '.')` is
 * `root` itself — so an id of `.` (or any id with a separator) turns this
 * per-session purge into "delete every session's side questions on disk". The
 * route validates its id; this check is the independent second gate, because
 * this function is reachable on its own and its failure mode is other
 * sessions' data.
 */
export async function purgeBtwForSession(sessionId: string): Promise<number> {
  if (!isSinglePathSegment(sessionId)) return 0;

  const topics = await listBtwTopics(sessionId);
  for (const topic of topics) {
    const runtime = getBtwRuntime(topic.id);
    if (runtime) {
      // Disposes the child; a running turn is settled as cancelled rather than
      // left to write into a transcript this purge is about to remove.
      await runtime.dispose();
      forgetBtwRuntime(topic.id);
    }
    await deleteBtwTopic(topic.id);
    await removeBtwWorkspace((await resolveBtwWorkspacePaths(sessionId, topic.id)).dir);
  }
  // The per-session directory as a whole: a topic whose row is already gone can
  // still have a workspace (a crash between the two, a manual row delete).
  await removeBtwWorkspace(path.join(await getBtwRoot(), sessionId));
  return topics.length;
}
