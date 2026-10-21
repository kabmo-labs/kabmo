/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Sending a NEW chat's prompt into a wait instead of dispatching it now.
 *
 * The prompt never reaches omp from here: the row is written server-side and a
 * sweep spawns the session when the dependency finishes. That is why this path
 * clears the composer and marks the pending row, and why it does NOT arm the
 * generating state — nothing is running yet, and a spinner would say otherwise.
 *
 * The dependency is re-checked against the live status map at send time. A
 * dropdown opened a minute ago can name a session that has since finished, and
 * a prompt held on it would be released by the very next sweep: the user asked
 * to wait, so the honest outcome is to send it now and say so.
 */

import type { Attachment } from '@/shared/types/chat';
import type { WorkspaceFolderData } from '@/shared/types/workspace';
import { prepareQueuedAttachments } from '@/shared/lib/chat/attachments';
import { createWaitingPromptRequest } from '@/client/hooks/chat/waiting/store';
import { markPendingSessionWaiting } from '@/client/hooks/chat/omp/pending-waiting';
import type { WaitingCandidate } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';

/**
 * The slice of the composer's deps record a hold needs.
 *
 * Structural, not an import of the actions record: the caller passes that whole
 * record and TypeScript checks it against this, so the two stay decoupled and
 * this module never depends on the send hook's shape.
 */
export interface ComposerHoldDeps {
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  accessModeRef: { current: string };
  spawnSelectionRef?: { current: { plan: boolean; goal: boolean } | null };
  streamStatusMap?: Record<string, string | undefined>;
  setInputValue: (value: string) => void;
  setInputAttachments: (attachments: Attachment[] | ((prev: Attachment[]) => Attachment[])) => void;
  reportActionError: (message: string) => void;
  clearWaitingDependency?: () => void;
  waitingDependencyRef?: { current: WaitingCandidate | null };
}

/**
 * The composer's own entry point: hold the draft if a dependency is picked and
 * the chat is idle, else answer false and let the normal send proceed.
 *
 * Idle is part of the condition rather than the caller's business: a chat with
 * a run in flight queues its follow-up (or steers), which is a different
 * decision made further down the send path.
 */
export async function holdFromComposer(
  deps: ComposerHoldDeps,
  text: string,
  attachments: Attachment[],
  busy: boolean,
): Promise<boolean> {
  const choice = deps.waitingDependencyRef?.current ?? null;
  if (!choice || busy) return false;
  return holdPromptForDependency({
    sessionId: deps.sessionId,
    folders: deps.folders,
    selectedFolderId: deps.selectedFolderId,
    composerModelRef: deps.composerModelRef,
    accessModeRef: deps.accessModeRef,
    spawnModesRef: deps.spawnSelectionRef ?? { current: null },
    streamStatusMap: deps.streamStatusMap ?? {},
    setInputValue: deps.setInputValue,
    setAttachments: (next) => deps.setInputAttachments(next),
    reportActionError: deps.reportActionError,
    clearChoice: () => deps.clearWaitingDependency?.(),
  }, choice, text, attachments);
}

export interface HoldDeps {
  sessionId: string | null;
  folders: WorkspaceFolderData[];
  selectedFolderId: number | null;
  composerModelRef: { current: { provider: string; modelId: string; thinkingLevel: string } | null };
  accessModeRef: { current: string };
  spawnModesRef: { current: { plan: boolean; goal: boolean } | null };
  streamStatusMap: Record<string, string | undefined>;
  setInputValue: (value: string) => void;
  setAttachments: (attachments: Attachment[]) => void;
  reportActionError: (message: string) => void;
  /** The dependency pick, cleared once the prompt is held. */
  clearChoice: () => void;
}

/**
 * Hold `text` until `dependency` finishes.
 *
 * Returns true when the prompt was held — the caller must then do nothing else.
 * A false return means the caller should fall through to a normal send: either
 * there is no dependency, or it is no longer running.
 */
export async function holdPromptForDependency(
  deps: HoldDeps,
  dependency: WaitingCandidate | null,
  text: string,
  attachments: Attachment[],
): Promise<boolean> {
  if (!dependency) return false;
  if (deps.streamStatusMap[dependency.id] !== 'stream') {
    // Stale pick: the session finished while the draft was being written. Send
    // normally rather than creating a wait that releases on the next sweep.
    deps.reportActionError(`"${dependency.title}" has already finished — sending now instead of waiting.`);
    deps.clearChoice();
    return false;
  }
  const folder = deps.folders.find((entry) => String(entry.id) === String(deps.selectedFolderId));
  const cwd = folder?.project_path || folder?.name;
  if (!cwd) {
    deps.reportActionError('Pick a workspace before holding this prompt.');
    return false;
  }

  // Attachments become the persisted shape here, while the live `File` handles
  // still exist: the server sends the prompt hours later, from the row.
  const prepared = await prepareQueuedAttachments(attachments);
  const composerPick = deps.composerModelRef.current;
  try {
    const created = await createWaitingPromptRequest({
      pendingId: deps.sessionId,
      dependsOn: dependency.id,
      dependsOnTitle: dependency.title,
      prompt: text,
      attachments: prepared,
      model: composerPick ? { ...composerPick, accessMode: deps.accessModeRef.current } : null,
      modes: deps.spawnModesRef.current,
      cwd,
      folderId: folder ? Number(folder.id) : null,
    });
    if (deps.sessionId) {
      markPendingSessionWaiting(deps.sessionId, {
        waitId: created.id,
        dependsOn: dependency.id,
        dependsOnTitle: dependency.title,
      });
    }
    deps.setInputValue('');
    deps.setAttachments([]);
    deps.clearChoice();
    return true;
  } catch (error) {
    // The draft is KEPT: a refusal that also threw away the prompt would be the
    // worst of both outcomes, and the composer still holds what the user wrote.
    deps.reportActionError(error instanceof Error ? error.message : String(error));
    return false;
  }
}
