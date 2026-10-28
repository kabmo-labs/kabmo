/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * BTW operations: list, ask (new topic or follow-up), abort, promote, delete.
 *
 * The rules here are omp's own `/btw` rules, expressed against Kabmo's
 * storage:
 *  - one side question in flight per session (no implicit queue, no implicit
 *    cancel — a second question is refused, exactly like the TUI);
 *  - a new question is its own topic; only a follow-up continues one, and it
 *    sees only that topic's turns (plus the parent's context);
 *  - the side conversation runs on the CHAT's model and thinking selector, read
 *    from the parent transcript at every ask — the panel has no pickers of its
 *    own, exactly like omp's `/btw`, which runs the side turn on
 *    `request.session.model`;
 *  - promotion is refused once the parent transcript has moved past the point
 *    the topic was snapshotted at, while a turn is still running, and for a
 *    topic with follow-ups (a branch carries one question/answer pair).
 */

import { isMockMode } from '@/server/mock.server';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { readRawHeaderLine } from '@/server/lib/omp/session/files';
import { loadSessionModel, loadSessionThinkingSelector } from '@/server/lib/omp/session/messages';
import { getRpcSession, resolveSpawnCwd } from '@/server/lib/omp/rpc/manager';
import { composeMessageWithTextAttachments, type AttachedTextFileData } from '@/shared/lib/chat/attachments';
import {
  createBtwTopic,
  deleteBtwTopic,
  getBtwTopic,
  readBtwTopicLeaf,
  setBtwTopicPromoted,
} from '@/server/lib/btw/store.server';
import { promoteBtwTopic as materializePromotedTopic, readTranscriptLeaf, removeBtwWorkspace, resolveBtwWorkspacePaths } from '@/server/lib/btw/session-copy.server';
import { btwStateFor, ensureBtwRuntime, findRunningBtwRuntime, forgetBtwRuntime, getBtwRuntime, publishBtwState } from '@/server/lib/btw/registry.server';
import { BtwError, type BtwImages } from '@/server/lib/btw/runtime.server';
import type { BtwState } from '@/shared/types';

/** Longest a topic label may be, matching the sidebar's session-title length. */
const TOPIC_TITLE_CHARS = 60;

/**
 * Marks a session that was promoted out of a side question, in the sidebar list
 * the user reads. Applied to the PROMOTED SESSION only — the topic's own label
 * in the panel keeps the plain question.
 *
 * It lives in the session title because that is what the sidebar renders, and
 * the title slot (line 1) is authoritative over the header. omp's auto-title
 * cannot overwrite it: its latch is `autoTitlePending = messageCount === 0`, and
 * a promoted transcript always carries the parent's history.
 *
 * Note the sidebar capitalizes the first character (`SessionItem`), so this
 * renders as `Btw: …`.
 */
const PROMOTED_TITLE_PREFIX = 'btw: ';

function topicTitle(question: string): string {
  const firstLine = question.trim().split('\n')[0].trim();
  return firstLine.slice(0, TOPIC_TITLE_CHARS);
}

function assertAvailable(): void {
  if (isMockMode()) {
    throw new BtwError('Side questions need a real omp session; Kabmo is running in demo mode.', 'btw_unavailable');
  }
}

/** Resolve the parent session file and the directory its child must run in. */
async function resolveParent(sessionId: string): Promise<{ sessionFile: string; cwd: string }> {
  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) throw new BtwError('Session not found', 'session_not_found');
  const header = await readRawHeaderLine(sessionFile);
  const recordedCwd = header && typeof header.cwd === 'string' ? header.cwd : null;
  return { sessionFile, cwd: await resolveSpawnCwd(recordedCwd) };
}

export async function getBtwState(sessionId: string): Promise<BtwState> {
  return btwStateFor(sessionId);
}

export interface AskBtwInput {
  /** Continue this topic; omitted starts a new one. */
  topicId?: string;
  question: string;
  images?: BtwImages;
  /**
   * Inline-able text files, read by the client at attach time and sent with the
   * question. They are appended to the prompt body exactly as a chat prompt
   * carries them (`composeMessageWithTextAttachments`), so a side question can
   * be asked about a file the same way a chat turn can.
   */
  textFiles?: AttachedTextFileData[];
}

export async function askBtw(sessionId: string, input: AskBtwInput): Promise<BtwState> {
  assertAvailable();
  const question = input.question.trim();
  if (!question) throw new BtwError('A side question needs some text.', 'btw_empty');

  if (findRunningBtwRuntime(sessionId)) {
    throw new BtwError('A side question is still running — wait for it, or cancel it first.', 'btw_busy');
  }

  const parent = await resolveParent(sessionId);
  const existing = input.topicId ? await getBtwTopic(input.topicId) : undefined;
  if (input.topicId && (!existing || existing.sessionId !== sessionId)) {
    throw new BtwError('Unknown side question.', 'btw_topic_not_found');
  }

  // The side conversation mirrors the chat: model and thinking selector are read
  // from the parent transcript at every ask, so a change made in the chat reaches
  // the next side question (omp reads `request.session.model` the same way).
  const model = await topicModel(parent.sessionFile);
  const thinkingLevel = await loadSessionThinkingSelector(parent.sessionFile);
  const topic =
    existing ??
    (await createBtwTopic({
      sessionId,
      title: topicTitle(question),
      model,
      thinkingLevel,
    }));

  const runtime = ensureBtwRuntime({
    topicId: topic.id,
    sessionId,
    parentSessionFile: parent.sessionFile,
    cwd: parent.cwd,
    model,
    thinkingLevel,
  });

  // A live child keeps the model it was spawned with; re-target it before the
  // prompt so this question runs on what the chat is on NOW.
  await runtime.retarget(model, thinkingLevel);
  await runtime.ask(composeMessageWithTextAttachments(question, input.textFiles ?? []), input.images);
  return btwStateFor(sessionId);
}

/** The parent's model, so the side conversation runs on the visible model. */
async function topicModel(sessionFile: string) {
  const model = await loadSessionModel(sessionFile);
  return model ? { provider: model.provider, id: model.modelId } : undefined;
}

export async function abortBtw(sessionId: string, topicId: string): Promise<BtwState> {
  const topic = await getBtwTopic(topicId);
  if (!topic || topic.sessionId !== sessionId) throw new BtwError('Unknown side question.', 'btw_topic_not_found');
  await getBtwRuntime(topicId)?.abort();
  return btwStateFor(sessionId);
}

/**
 * Refuse a session operation that would move the conversation out from under a
 * running side question. omp blocks the same operations while a `/btw` answer is
 * in flight or unsaved (`BtwController.withSessionMove` / `flush`); a Kabmo
 * chat that switched sessions mid-question would leave the answer attached to a
 * transcript nobody is looking at.
 */
export async function assertBtwIdle(sessionId: string, action: string): Promise<void> {
  if (findRunningBtwRuntime(sessionId)) {
    throw new BtwError(`A side question is still running — wait for it, or cancel it, before you ${action}.`, 'btw_busy');
  }
}

/**
 * Turn the topic into a session of the chat's own: a branch of the parent
 * conversation whose tip is the side answer, opened by the caller.
 */
export async function promoteBtw(sessionId: string, topicId: string): Promise<{ sessionId: string }> {
  assertAvailable();
  const topic = await getBtwTopic(topicId);
  if (!topic || topic.sessionId !== sessionId) throw new BtwError('Unknown side question.', 'btw_topic_not_found');
  // Promotion materializes a file beside the parent, so it happens once: a
  // second promote re-opens the branch it already wrote.
  if (topic.promotedSessionId) return { sessionId: topic.promotedSessionId };
  if (topic.turns.length === 0) throw new BtwError('This side question has no answer to promote yet.', 'btw_empty');
  if (topic.turns.some((turn) => turn.status === 'running')) {
    throw new BtwError('Wait for the side answer to finish, or cancel it, before promoting it.', 'btw_busy');
  }
  // omp's branch action carries ONE question/answer pair and refuses a topic with
  // follow-ups, so the earlier turns cannot be silently dropped from the branch.
  if (topic.turns.length > 1) {
    throw new BtwError(
      'A side question with follow-ups cannot be promoted — omp branches one answer at a time.',
      'btw_multi_turn',
    );
  }

  const parent = await resolveParent(sessionId);
  // The branch is cut from the parent's transcript, so the chat must be idle:
  // omp's guard refuses while `session.isStreaming`.
  if (getRpcSession(sessionId)?.isRunning()) {
    throw new BtwError('The chat is still running — wait for it to finish before promoting a side question.', 'btw_busy');
  }
  const snapshotLeaf = await readBtwTopicLeaf(topicId);
  if (snapshotLeaf) {
    const currentLeaf = await readTranscriptLeaf(parent.sessionFile);
    if (currentLeaf !== snapshotLeaf) {
      throw new BtwError(
        'The chat has moved on since this side question started, so it can no longer branch from it.',
        'btw_stale',
      );
    }
  }

  // The child would keep appending to the transcript we are about to move.
  const runtime = getBtwRuntime(topicId);
  if (runtime) {
    await runtime.dispose();
    forgetBtwRuntime(topicId);
  }

  const paths = await resolveBtwWorkspacePaths(sessionId, topicId);
  const title = `${PROMOTED_TITLE_PREFIX}${topicTitle(topic.turns[0].question)}`;
  const created = await materializePromotedTopic({
    parentSessionFile: parent.sessionFile,
    topicSessionFile: paths.sessionFile,
    title,
  });
  await setBtwTopicPromoted(topicId, created);
  await publishBtwState(sessionId);
  return { sessionId: created };
}

export async function removeBtw(sessionId: string, topicId: string): Promise<BtwState> {
  const topic = await getBtwTopic(topicId);
  if (!topic || topic.sessionId !== sessionId) throw new BtwError('Unknown side question.', 'btw_topic_not_found');
  const runtime = getBtwRuntime(topicId);
  if (runtime) {
    await runtime.dispose();
    forgetBtwRuntime(topicId);
  }
  await deleteBtwTopic(topicId);
  await removeBtwWorkspace((await resolveBtwWorkspacePaths(sessionId, topicId)).dir);
  await publishBtwState(sessionId);
  return btwStateFor(sessionId);
}
