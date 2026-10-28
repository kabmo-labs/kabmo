/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One side question's lifecycle: asking, aborting, settling, and reclaiming the
 * child that carried it.
 *
 * Extracted from `BtwRuntime` so that file stays under the repo's per-file size
 * ceiling, in the same host-interface shape `session-commands.ts` uses for the
 * chat wrapper. The runtime owns the process and the frame routing; the rules
 * below decide when a turn starts, what a settled turn is worth, and when an
 * idle child is worth keeping.
 */

import type { RpcProcess, RpcFrame } from '@/server/lib/omp/rpc/process';
import { GET_STATE_TIMEOUT_MS, IDLE_REAP_MS, PROMPT_ACK_TIMEOUT_MS } from '@/server/lib/omp/rpc/constants';
import { buildBtwPrompt } from '@/server/lib/btw/prompt';
import { boundSideReply } from '@/server/lib/btw/reply';
import { appendBtwTurn, settleRunningBtwTurns, updateBtwTurn } from '@/server/lib/btw/store.server';
import type { BtwRuntimeSink } from '@/server/lib/btw/runtime.server';
import { toChatMessage } from '@/shared/lib/omp/session/mapper';
import { describeAssistantPhase, describeToolActivity } from '@/shared/lib/chat/timeline/tool-verbs';
import { isNoticeRow } from '@/shared/lib/chat/notice-row';
import type { AgentImage, BtwTurnStatus, ChatMessageData } from '@/shared/types';

/** Longest an aborted turn may stay unsettled before its child is reclaimed. */
const ABORT_GRACE_MS = 10_000;

/** The runtime state these rules read and write. */
export interface BtwLifecycleHost {
  readonly topicId: string;
  readonly sink: BtwRuntimeSink;
  /** A question is in flight in this topic. */
  readonly running: boolean;
  proc: RpcProcess | null;
  idleTimer: NodeJS.Timeout | null;
  abortTimer: NodeJS.Timeout | null;
  lastIdleReset: number;
  turnIndex: number | null;
  /** True from the moment a turn starts settling until its row is written. */
  settling: boolean;
  /** The turn's conversation so far (chat-shaped; see `trackTurnMessage`). */
  messages: ChatMessageData[];
  /** Last activity phrase published, so repeats are not re-published. */
  activity: string;
  disposing: Promise<void> | null;
  /** Spawn (or reuse) the child. */
  start(): Promise<RpcProcess>;
  /** Drop the child and everything scoped to it. */
  teardownChild(): Promise<void>;
}

/** Ask (or follow up) — the caller has already refused concurrent turns. */
export async function askSideQuestion(host: BtwLifecycleHost, question: string, images?: AgentImage[]): Promise<void> {
  if (host.running) throw new Error('A side question is already running here.');
  host.turnIndex = await appendBtwTurn(host.topicId, question);
  host.messages = [];
  host.activity = '';
  host.sink.stateChanged();
  try {
    const proc = await host.start();
    await proc.sendCommand(
      { type: 'prompt', message: buildBtwPrompt(question), ...(images?.length ? { images } : {}) },
      PROMPT_ACK_TIMEOUT_MS,
    );
  } catch (error) {
    await settleSideTurn(host, 'error');
    host.sink.publish({
      type: 'btw_error',
      topicId: host.topicId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
  resetSideIdleTimer(host, true);
}

/** Cancel the running question, keeping whatever text already arrived. */
export async function abortSideTurn(host: BtwLifecycleHost): Promise<void> {
  if (!host.running) return;
  const proc = host.proc;
  if (!proc?.isAlive) {
    await settleSideTurn(host, 'cancelled');
    return;
  }
  try {
    await proc.sendCommand({ type: 'abort' }, GET_STATE_TIMEOUT_MS);
  } catch {
    // An unanswered abort is the escalate-to-cancel path below, not an error.
  }
  // `abort` parks the turn on a fresh grace window: the settle that follows is
  // the one that decides. The guard is type-required — these fields are
  // `Timeout | null` and `clearTimeout` takes `Timeout | undefined`.
  if (host.abortTimer) clearTimeout(host.abortTimer);
  const timer = setTimeout(() => {
    host.abortTimer = null;
    void disposeIfUnsettled(host);
  }, ABORT_GRACE_MS);
  timer.unref?.();
  host.abortTimer = timer;
}

/**
 * Drop `toolCall` content blocks from a message.
 *
 * omp's own side turn filters them out of its final message
 * (`agent-session.ts`: `content.filter(block => block.type !== 'toolCall')`)
 * because the call was never executed. A model that emits one anyway — a
 * hallucinated call against the tool catalog omp keeps attached for the prompt
 * cache — must not surface here as a card for a tool that never ran.
 */
function withoutToolCalls(record: Record<string, unknown>): Record<string, unknown> {
  const content = record.content;
  if (!Array.isArray(content)) return record;
  const kept = content.filter((block) => !isToolCallBlock(block));
  if (kept.length === content.length) return record;
  return { ...record, content: kept };
}

/** Whether a content block is a tool call — the block shape omp's own filter reads. */
function isToolCallBlock(block: unknown): boolean {
  if (!block || typeof block !== 'object' || !('type' in block)) return false;
  return block.type === 'toolCall';
}

/**
 * The turn's conversation as it accumulates, in the chat's own shape.
 *
 * omp emits `message_update` per SEGMENT, each carrying that segment's full
 * accumulated content and its own message id — so a same-id frame replaces the
 * entry in place and a new id appends. That is exactly the upsert the chat
 * timeline's `onMessageUpdate` performs, and keeping it identical is what makes
 * a side answer render through the chat's own `MessageList`.
 *
 * `streaming` is the chat stream's own distinction, and it matters in two
 * places: a COMPLETED message is the authoritative copy (it carries the turn's
 * real usage where the deltas report zeros), and its thinking is no longer
 * generating — mapping it as a streaming row left every reloaded turn with an
 * open, pulsing accordion.
 */
export function trackTurnMessage(host: BtwLifecycleHost, frame: RpcFrame, streaming = true): void {
  const raw = frame.message;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const record = raw as Record<string, unknown>;
  // A side turn executes no tool (see `child.server.ts`), so omp emits no
  // `toolResult` for it. Dropping the role keeps a stray one from becoming a row.
  if (record.role === 'toolResult') return;
  const turnIndex = host.turnIndex;
  if (turnIndex === null) return;
  const converted = toChatMessage(withoutToolCalls(record), streaming);
  if (!converted) return;
  const existing = host.messages.findIndex((message) => message.id === converted.id);
  host.messages =
    existing === -1
      ? [...host.messages, converted]
      : [...host.messages.slice(0, existing), converted, ...host.messages.slice(existing + 1)];
  host.sink.publish({ type: 'btw_message', topicId: host.topicId, turnIndex, message: converted });
}

/** The activity phrase for the panel's indicator, from the side child's frames. */
export function trackTurnActivity(host: BtwLifecycleHost, frame: RpcFrame): void {
  const verb = frame.type === 'tool_execution_start'
    ? describeToolActivity({
        name: typeof frame.toolName === 'string' ? frame.toolName : undefined,
        args: frame.args,
        intent: typeof frame.intent === 'string' ? frame.intent : undefined,
      })
    : describeAssistantPhase(frame.assistantMessageEvent);
  if (!verb || verb === host.activity) return;
  host.activity = verb;
  host.sink.publish({ type: 'btw_activity', topicId: host.topicId, verb });
}

/** The plain-text answer, for the turn's summary fields. */
function answerText(messages: ChatMessageData[], fallback: string): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'user' || isNoticeRow(message)) continue;
    if (message.content) return message.content;
  }
  return fallback;
}

/**
 * Write a turn's outcome. `busy` (`settling`) holds the topic live across the
 * write: a state read landing in this window must not settle the row as
 * `interrupted` (see `btwStateFor`).
 */
export async function settleSideTurn(host: BtwLifecycleHost, status: BtwTurnStatus, answer?: string): Promise<void> {
  const turnIndex = host.turnIndex;
  if (turnIndex === null) return;
  host.turnIndex = null;
  // `||`, not `??`: a turn that only ran tools has no prose, and the caller
  // passes an empty string rather than undefined — the summary must then fall
  // through to whatever the conversation does carry. Bounded the way omp bounds
  // its own side replies (see `reply.ts`).
  const text = boundSideReply(answer || answerText(host.messages, ''));
  host.settling = true;
  try {
    await updateBtwTurn(host.topicId, turnIndex, { answer: text, status, messages: host.messages });
  } finally {
    host.settling = false;
    host.messages = [];
    host.sink.stateChanged();
  }
}

/** The child died. A turn that was in flight can never complete now. */
export function handleSideChildExit(host: BtwLifecycleHost, stderrTail: string): void {
  const wasRunning = host.running;
  host.proc = null;
  if (!wasRunning) return;
  void settleRunningBtwTurns(host.topicId, 'interrupted').then(() => {
    host.turnIndex = null;
    host.messages = [];
    host.sink.stateChanged();
    const detail = stderrTail.trim().split('\n').pop();
    host.sink.publish({
      type: 'btw_error',
      topicId: host.topicId,
      message: `The side session exited before answering${detail ? `: ${detail}` : '.'}`,
    });
  });
}

/** Clear the timers and drop the child. */
export async function teardownSideChild(host: BtwLifecycleHost): Promise<void> {
  // Type-required guards: the fields are `Timeout | null`, `clearTimeout` takes
  // `Timeout | undefined`.
  if (host.idleTimer) clearTimeout(host.idleTimer);
  if (host.abortTimer) clearTimeout(host.abortTimer);
  host.idleTimer = null;
  host.abortTimer = null;
  const proc = host.proc;
  host.proc = null;
  if (proc) await proc.dispose().catch(() => {});
  host.disposing = null;
}

async function disposeIfUnsettled(host: BtwLifecycleHost): Promise<void> {
  if (host.running) await settleSideTurn(host, 'cancelled');
  await host.teardownChild();
}

/**
 * Reclaim an idle child after `IDLE_REAP_MS`. The reschedule is throttled:
 * every streamed delta would otherwise clear and re-arm the timer.
 */
export function resetSideIdleTimer(host: BtwLifecycleHost, force = false): void {
  const now = Date.now();
  if (!force && host.idleTimer && now - host.lastIdleReset < 5_000) return;
  host.lastIdleReset = now;
  if (host.idleTimer) clearTimeout(host.idleTimer);
  const timer = setTimeout(() => {
    if (host.running) {
      resetSideIdleTimer(host, true);
      return;
    }
    void host.teardownChild();
  }, IDLE_REAP_MS);
  timer.unref?.();
  host.idleTimer = timer;
}
