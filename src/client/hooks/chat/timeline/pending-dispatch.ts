/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The first send of a pending chat that has no omp session yet.
 *
 * Two shapes, one decision: a chat started from "New child session" has a
 * `parentSessionId` in the pending store and is created through
 * `/api/sessions/spawn`; every other pending chat is a top-level session and
 * goes through `POST /api/agent/new`. Both adopt the id the server answers
 * with, keep the optimistic rows, and are the ONLY place a pending id becomes
 * a real one.
 *
 * Split from `send.ts` for the per-file ceiling; it owns no rendering.
 */

import type { Attachment, ChatMessageData, PromptDispatchResult } from '@/shared/types';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';
import type { ChatTimelineSendDeps } from '@/client/hooks/chat/timeline/send-props';
import { adoptPendingSession, pendingEntryFor } from '@/client/hooks/chat/omp/pending-sessions';
import { recordSpawnHarness } from '@/client/hooks/chat/timeline/spawn-harness';
import { childSpawnBody } from '@/client/hooks/chat/timeline/child-spawn';
import { forkRequestBody } from '@/client/hooks/chat/timeline/fork-request';
import { forkPreviewMessages } from '@/shared/lib/chat/timeline/fork-preview';
import { collectImages } from '@/client/hooks/chat/timeline/send-helpers';

type PendingDispatchDeps = Pick<
  ChatTimelineSendDeps,
  | 'folders'
  | 'selectedFolderId'
  | 'sessionId'
  | 'ompAgent'
  | 'setLocalMessages'
  | 'setGenerating'
  | 'aiPlaceholderIdRef'
  | 'adoptedSessionIdRef'
  | 'optimisticUserIdRef'
  | 'seedSession'
  | 'pendingComposerModelRef'
  | 'pendingThinkingLevelRef'
  | 'pendingHarnessRef'
  | 'pendingAgentModeRef'
  | 'accessModeRef'
  | 'spawnSelectionRef'
  | 'goalArmRef'
  | 'spawnWorktreeRef'
  | 'reportActionError'
  | 'setSearchParams'
>;

export interface PendingDispatchInput {
  text: string;
  attachments: Attachment[];
  /** The assembled prompt: text attachments inlined, `@agent` translated. */
  promptText: string;
  userMsgId: string;
  aiPlaceholderId: string;
  newUserMsg: ChatMessageData;
  /** A New Chat card's inherited harness, which outranks a stale pending pick. */
  options?: { harness?: string | null };
  startArmedGoal: (sessionId: string, armed: ArmedGoal, promptText: string) => Promise<boolean>;
}

/** Roll the optimistic turn back after a refused dispatch. */
function rollback(
  deps: PendingDispatchDeps,
  userMsgId: string,
  aiPlaceholderId: string,
  error: string,
): PromptDispatchResult {
  deps.setLocalMessages((prev) => prev.filter((m) => m.id !== userMsgId && m.id !== aiPlaceholderId));
  deps.aiPlaceholderIdRef.current = null;
  deps.optimisticUserIdRef.current = null;
  deps.setGenerating(false);
  deps.reportActionError(`Prompt not sent: ${error}`);
  return { ok: false, busy: false, error };
}

/** Persist the user's turn for a session omp has not scanned yet. */
function persistUserTurn(sessionId: string, newUserMsg: ChatMessageData): void {
  fetch(`/api/chat/${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [newUserMsg] }),
  }).catch((err) => console.error('Error persisting spawned user turn:', err));
}

/**
 * Put the branch's inherited history above the optimistic turn.
 *
 * The fork's file already holds these rows, but the timeline cannot show them
 * on its own: while a run THIS PAGE dispatched owns the rows, a committed read
 * is a lagging snapshot and is skipped (`timelineOwnedByLiveRun`), and a run
 * that ends cleanly does not re-read the transcript (only one that lost frames
 * does). So the first fork turn rendered in an apparently empty chat, and the
 * conversation it continues appeared only after a reload.
 *
 * The slice is the preview's own (`forkPreviewMessages`, the server's cut), so
 * what lands here is exactly the prefix the branch file starts with. Read-only
 * and non-blocking: the run is already in flight, and a failed read costs the
 * prefix — never the turn.
 */
function prependInheritedHistory(
  deps: PendingDispatchDeps,
  adoptedId: string,
  sourceSessionId: string,
  anchorEntryId: string | null,
): void {
  fetch(`/api/chat/${encodeURIComponent(sourceSessionId)}?limit=all`)
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = (await response.json()) as { session?: { messages?: ChatMessageData[] } } | null;
      const inherited = forkPreviewMessages(body?.session?.messages ?? [], anchorEntryId);
      // The operator may have switched chats while this read was in flight: the
      // rows belong to the fork adopted above, never to whatever is on screen.
      if (inherited.length === 0 || deps.adoptedSessionIdRef.current !== adoptedId) return;
      deps.setLocalMessages((prev) =>
        // A committed read may already carry the prefix (e.g. a reload raced
        // this one); prepending it again would render the history twice.
        prev.some((row) => row.id === inherited[0]!.id) ? prev : [...inherited, ...prev],
      );
    })
    .catch((error: unknown) => {
      deps.reportActionError(
        `Could not show the forked history: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
}

export async function dispatchPendingChat(
  deps: PendingDispatchDeps,
  input: PendingDispatchInput,
): Promise<PromptDispatchResult | null> {
  const currentFolder = deps.folders.find((f) => String(f.id) === String(deps.selectedFolderId));
  // A worktree pick wins: the chat is BORN there, so no relocation is ever
  // needed and the child's cwd is right for its whole life.
  const cwd = deps.spawnWorktreeRef.current || currentFolder?.project_path || currentFolder?.name;
  if (!cwd) return null;

  const images = collectImages(input.attachments);
  deps.optimisticUserIdRef.current = input.userMsgId;
  const composerModel = deps.pendingComposerModelRef.current;
  const composerThinking = deps.pendingThinkingLevelRef.current;
  const entry = pendingEntryFor(deps.sessionId);
  const parentSessionId = entry?.parentSessionId ?? null;

  if (entry?.forkSourceSessionId) {
    const response = await fetch(
      `/api/sessions/${encodeURIComponent(entry.forkSourceSessionId)}/fork`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          forkRequestBody(entry.forkAnchorEntryId ?? null, {
            prompt: input.promptText,
            images,
            model: composerModel,
            thinkingLevel: composerThinking,
            accessMode: deps.accessModeRef.current,
          }),
        ),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      sessionId?: string;
      error?: string;
      code?: string;
    } | null;
    if (!response.ok || !body?.sessionId) {
      if (body?.code === 'mock_mode') return null;
      return rollback(deps, input.userMsgId, input.aiPlaceholderId, body?.error ?? `HTTP ${response.status}`);
    }

    // A fork keeps the source's agent; the source row's harness was carried
    // into the pending entry when the Fork button opened this chat.
    recordSpawnHarness(body.sessionId, entry.harness ?? 'omp-rpc');
    deps.adoptedSessionIdRef.current = body.sessionId;
    adoptPendingSession(deps.sessionId, body.sessionId, currentFolder?.id ?? null);
    if (composerModel) deps.seedSession({ model: composerModel });
    deps.pendingComposerModelRef.current = null;
    deps.pendingThinkingLevelRef.current = null;
    deps.pendingHarnessRef.current = null;
    persistUserTurn(body.sessionId, input.newUserMsg);
    deps.setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', body.sessionId!);
      next.delete('forkFrom');
      next.delete('forkAt');
      next.delete('parentSessionId');
      return next;
    }, { replace: true });
    prependInheritedHistory(
      deps,
      body.sessionId,
      entry.forkSourceSessionId,
      entry.forkAnchorEntryId ?? null,
    );
    return { ok: true, busy: false };
  }

  if (parentSessionId) {
    const response = await fetch('/api/sessions/spawn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        childSpawnBody(parentSessionId, input.promptText, {
          harness: input.options?.harness ?? deps.pendingHarnessRef.current,
          model: composerModel,
          thinkingLevel: composerThinking,
          accessMode: deps.accessModeRef.current,
          images,
        }),
      ),
    });
    const body = (await response.json().catch(() => null)) as {
      sessionId?: string;
      harness?: string;
      model?: { provider: string; modelId: string } | null;
      error?: string;
      code?: string;
    } | null;
    if (!response.ok || !body?.sessionId) {
      // MOCK mode has no agent process BY DESIGN; the simulated stream below
      // answers the demo shell instead of reporting a failure.
      if (body?.code === 'mock_mode') return null;
      return rollback(deps, input.userMsgId, input.aiPlaceholderId, body?.error ?? `HTTP ${response.status}`);
    }

    recordSpawnHarness(body.sessionId, body.harness ?? 'omp-rpc');
    deps.adoptedSessionIdRef.current = body.sessionId;
    adoptPendingSession(deps.sessionId, body.sessionId, currentFolder?.id ?? null);
    // The child's resolved model is the one its first turn runs on; seed it so
    // the composer replacing the pending view reports it before omp's JSONL
    // carries a model_change entry.
    deps.seedSession({
      ...(body.model ? { model: body.model } : {}),
      ...(composerThinking ? { thinkingLevel: composerThinking } : {}),
    });
    deps.pendingComposerModelRef.current = null;
    deps.pendingThinkingLevelRef.current = null;
    deps.pendingHarnessRef.current = null;
    persistUserTurn(body.sessionId, input.newUserMsg);
    deps.setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', body.sessionId!);
      // The parameter belonged to the pending chat; a real session's URL must
      // not keep a stale parent hint for a later pending chat.
      next.delete('parentSessionId');
      return next;
    }, { replace: true });
    return { ok: true, busy: false };
  }

  // Top-level pending chat: the existing `/api/agent/new` spawn.
  const spawnModes = deps.spawnSelectionRef.current;
  const spawnSessionMode = deps.pendingAgentModeRef.current;
  const armed = deps.goalArmRef.current;
  const spawned = await deps.ompAgent.sendNewPrompt(
    input.promptText,
    cwd,
    images,
    {
      model: composerModel,
      thinkingLevel: composerThinking,
      accessMode: deps.accessModeRef.current,
      modes: spawnModes,
      ...(spawnSessionMode ? { sessionMode: spawnSessionMode } : {}),
      ...((input.options?.harness ?? deps.pendingHarnessRef.current)
        ? { harness: input.options?.harness ?? deps.pendingHarnessRef.current }
        : {}),
    },
    armed ? (id) => input.startArmedGoal(id, armed, input.promptText) : undefined,
  );
  if (spawned.ok) {
    const { session } = spawned;
    // The harness the SERVER answered with: `new.ts` reports it for an ACP
    // spawn and omits it for the RPC branch, which means omp. Read rather than
    // replayed from the request, so a pick the server did not honour cannot be
    // reported as the agent running the chat.
    recordSpawnHarness(session.sessionId, session.harness ?? 'omp-rpc');
    deps.spawnSelectionRef.current = null;
    deps.pendingAgentModeRef.current = null;
    deps.adoptedSessionIdRef.current = session.sessionId;
    // The pending row moves with the id; without this it vanished the moment
    // the URL stopped naming the pending id.
    adoptPendingSession(deps.sessionId, session.sessionId, currentFolder?.id ?? null);
    deps.seedSession({ model: session.model, thinkingLevel: composerThinking });
    deps.pendingComposerModelRef.current = null;
    deps.pendingThinkingLevelRef.current = null;
    deps.pendingHarnessRef.current = null;
    persistUserTurn(session.sessionId, input.newUserMsg);
    deps.setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('sessionId', session.sessionId);
      next.delete('parentSessionId');
      return next;
    }, { replace: true });
    return { ok: true, busy: false };
  }
  if (spawned.code !== 'mock_mode') {
    return rollback(deps, input.userMsgId, input.aiPlaceholderId, spawned.error);
  }
  return null;
}
