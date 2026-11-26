/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Work an ACP agent keeps doing AFTER it has answered `session/prompt`.
 *
 * Measured on agy 1.5.3: `invoke_subagent` returns immediately, the call is
 * marked `completed`, the agent writes "sedang membuatkan…", and
 * `session/prompt` resolves `end_turn` while the child still runs. The child's
 * answer is written to the agent's transcript but **no `session/update` frame
 * is sent while the connection is idle** — it is held until the next request
 * (google-antigravity/antigravity-cli#1461), so the operator saw a stopped chat.
 *
 * `session/load` is the one request that replays that transcript, so the turn
 * is followed by a probe: replay frames are collected instead of folded, and the
 * part past the answer already on screen is delivered as the continuation.
 *
 * **Text is not the only evidence.** In a real 155 s run the replay carried
 * `read_file` and a failed `run_command` and NO new `agent_message_chunk`, so a
 * probe waiting for prose reported nothing before its ceiling. New tool calls
 * are progress too, and each one re-arms the quiet window.
 *
 * Backs off 2s → 30s; gives up ten minutes past the last work evidence, an hour
 * after the turn regardless. Never invents a failure for an answer it missed.
 *
 * The PROBE and its pull live in `background-probe.ts`; this module owns what is
 * shared with a turn's own bookkeeping — detection, the suffix rule, and the
 * synthetic notice a session moves.
 */

import { stampMessageModel } from '@kabmo-labs/kabmo-acp/session-config/session-config';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import { extractTextFromContent } from '@kabmo-labs/kabmo-omp/mapper';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp/rpc-protocol/constants';

/** Tool names that hand work to a process the turn does not await.
 *
 *  `spawn_subagent` is grok's spelling and arrives only as `_meta["x.ai/tool"]`;
 *  `resolveToolIdentity` lifts it into the card's `name`, which is why this list
 *  still matches. Cursor's `task` is deliberately absent: its adapter runs the
 *  child inside the call and answers before `end_turn`, so there is nothing to
 *  probe for. */
const BACKGROUND_TOOLS: Record<string, true> = {
  invoke_subagent: true,
  spawn_subagent: true,
};

/** Whether a card names a call that outlives the turn. Reads the resolved
 *  `name`, so an adapter that hides it in `_meta` is detected too. */
export function isBackgroundToolName(name: string | undefined): boolean {
  return typeof name === 'string' && BACKGROUND_TOOLS[name.toLowerCase()] === true;
}

/** The tool-call ids the closed message already shows, so a replay of them is
 *  not reported as news. */
export function toolIdsOf(message: unknown): string[] {
  if (!message || typeof message !== 'object' || !('content' in message)) return [];
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!block || typeof block !== 'object') return [];
    const record = block as Record<string, unknown>;
    if (record.type !== 'toolCall') return [];
    return typeof record.id === 'string' && record.id ? [record.id] : [];
  });
}

/** Did this turn hand work to a background worker? Read from the closed
 *  assistant message, which is the only place the tool call survives. */
export function spawnsBackgroundWork(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message)) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if (!('type' in block) || block.type !== 'toolCall') return false;
    return 'name' in block && isBackgroundToolName(typeof block.name === 'string' ? block.name : undefined);
  });
}

/** The prose the operator already has, for the suffix comparison. */
export function assistantTextOf(message: unknown): string {
  if (!message || typeof message !== 'object' || !('content' in message)) return '';
  return extractTextFromContent(message.content).trim();
}

/**
 * The NEW assistant text in a replay, or null when it carries nothing past
 * what the operator has already seen.
 *
 * A replay repeats the whole conversation, and a long conversation's earlier
 * turns are not this turn's notice. Two guards keep the notice unique: the
 * replay segment must extend the known text, and a replay that diverges from it
 * (a retried prompt, a different agent's wording) is left alone rather than
 * guessed at.
 */
export function backgroundNotice(baseline: string, replay: string): string | null {
  const current = replay.trim();
  if (!current) return null;
  const known = baseline.trim();
  if (!known) return current;
  if (!current.startsWith(known)) return null;
  const extra = current.slice(known.length).trim();
  return extra.length > 0 ? extra : null;
}

/** The frames a delayed answer is delivered with. It is a complete run: the
 *  client's fold only clears its generating flag on a terminal `agent_end`. */
export function backgroundNoticeFrames(text: string): AgentEvent[] {
  const message = {
    role: 'assistant',
    id: `acp-bg-${crypto.randomUUID()}`,
    content: [{ type: 'text', text }],
  };
  return [
    { type: 'agent_start' },
    { type: 'turn_start' },
    {
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: text },
    },
    { type: 'message_end', message },
    { type: 'agent_end', isTerminal: true, stopReason: 'end_turn' },
  ];
}

/** What the session must move when the probe hands it the delayed answer. */
export interface BackgroundNoticeHost {
  sessionId: string;
  runModel: { provider: string; modelId: string } | null;
  /** Written: the notice IS one more assistant row. */
  messageCount: number;
  assistantCount: number;
  emit: (event: AgentEvent) => void;
}

export function deliverBackgroundNotice(host: BackgroundNoticeHost, text: string): void {
  host.messageCount += 1;
  host.assistantCount += 1;
  for (const event of backgroundNoticeFrames(text)) {
    host.emit(stampMessageModel(event, host.runModel));
  }
  emitRealtimeSignal('session-data-dirty', host.sessionId);
}
