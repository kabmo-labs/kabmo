/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The send path's deps and result, split from its implementation so the hook
 * file stays under the repo's per-file ceiling — the same split `chat-input/
 * props.ts` makes for the composer.
 *
 * Every field is documented where it changes behaviour; `send.ts` reads them
 * all.
 */

import type { Dispatch, SetStateAction } from 'preact/compat';
import type { Attachment, ChatMessageData, OmpAgentHandle, PromptDispatchResult, QueuedMessageModel } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import type { SessionSeed } from '@/client/hooks/chat/timeline/session-shapes';
import type { DeferredModelStore } from '@/client/hooks/chat/timeline/deferred-model';
import type { ArmedGoal } from '@/shared/lib/omp/mode/actions';

export interface ChatTimelineSendDeps {
  folders: any[];
  selectedFolderId: number | null;
  sessionId: string | null;
  isOmpSession: boolean;
  /** The harness that owns this chat (omp-rpc, claude, …), for the ONE rule
   *  that is omp-specific: the TUI-only slash-command guard. Undefined until
   *  the chat's harness resolves. */
  harness?: string | null;
  appSettings: Record<string, any>;
  ompAgent: OmpAgentHandle;
  setLocalMessages: Dispatch<SetStateAction<ChatMessageData[]>>;
  persistMessages: (messages: any[]) => void;
  setGenerating: (v: boolean, owned?: boolean) => void;
  setGeneratingVerb: (v: string) => void;
  /** Follow-gated scroll for stream chunks. */
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  /** Explicit user-action scroll: re-engages follow mode (send/steer). */
  jumpToBottom: (behavior?: ScrollBehavior) => void;
  aiPlaceholderIdRef: { current: string | null };
  adoptedSessionIdRef: { current: string | null };
  optimisticUserIdRef: { current: string | null };
  pendingUserDisplaysRef: { current: { sent: string; display: string }[] };
  /** Adopt the spawned session's identity (model + the thinking level the first
   *  prompt runs with) so the composer replacing the pending view shows it. */
  seedSession: (seed: SessionSeed) => void;
  /** Model/thinking picked in the composer before the session existed —
   *  applied to the spawn command so the first prompt runs with them. */
  pendingComposerModelRef: { current: { provider: string; modelId: string } | null };
  pendingThinkingLevelRef: { current: string | null };
  /** Harness picked on the pending `new-…` chat; rides the spawn. */
  pendingHarnessRef: { current: string | null };
  /** Global access-control mode (persisted user preference), read at send time
   *  so the spawn-capable requests carry the latest value. */
  accessModeRef: { current: ApprovalMode };
  /** Plan/goal picks made on a pending `new-…` chat, applied to the spawn that
   *  replaces it. Read here rather than from `modes` because the spawn happens
   *  outside the render that produced the pick, and it is the FIRST moment a
   *  child exists to carry the selection. */
  spawnSelectionRef: { current: { plan: boolean; goal: boolean } | null };
  /**
   * The goal the operator ARMED, read at send time. The goal is created by the
   * fence of THIS prompt — just before the prompt is dispatched — with
   * `startTurn: false`, so the turn the operator just wrote is the goal's first
   * turn. Read through a ref for the same reason `spawnSelectionRef` is: the
   * send runs outside the render that produced the pick.
   */
  goalArmRef: { current: ArmedGoal | null };
  /** Clears the armed goal once it has been consumed by this send. */
  disarmGoal: () => void;
  /**
   * The worktree the pending chat picked (`chat.spawnTarget`), read through a
   * REF because the composer is remounted by a stretch, a tab switch and a
   * reload while this handler is created once per deps record — the same reason
   * the waiting pick keeps one.
   */
  spawnWorktreeRef: { current: string | null };
  /** Picks the composer made while a turn was streaming. Pushed onto the
   *  session here, immediately before the prompt they were meant for. */
  deferredComposerPickRef: DeferredModelStore;
  abortControllerRef: { current: AbortController | null };
  setInputValue: (v: string) => void;
  /** Surface a refused send. The optimistic bubbles are rolled back either
   *  way; without this the operator's turn simply VANISHES, which is the
   *  "prompt failed to send" report this exists to answer. */
  reportActionError: (message: string) => void;
  setSearchParams: (fn: (prev: URLSearchParams) => URLSearchParams, opts?: { replace?: boolean }) => void;
}

export interface ChatTimelineSendResult {
  /** Steer the running turn; resolves with the outcome so a refusal can be
   *  reported (the composer is cleared before the request goes out). */
  steerOmpAgent: (text: string, attachments: Attachment[]) => Promise<PromptDispatchResult>;
  /** `model` re-applies a queued item's snapshot before the prompt runs
   *  (set_model / set_thinking_level RPC + prompt access mode). `busy: true`
   *  means omp REFUSED the prompt mid-turn — the caller queues it instead.
   *  `harness` is the New Chat dialog's inherited agent, used only by the
   *  brand-new-session branch (`/api/agent/new`). */
  executeSend: (
    text: string,
    attachments: Attachment[],
    options?: { model?: QueuedMessageModel | null; harness?: string | null },
  ) => Promise<PromptDispatchResult>;
}
