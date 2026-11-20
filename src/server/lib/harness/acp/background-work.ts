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
 */

import { collectReplayFrame, newToolNotice, type ReplaySegment } from '@/server/lib/harness/acp/background-replay';
import { stampMessageModel } from '@/server/lib/harness/acp/session-config';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

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

export const BACKGROUND_FIRST_DELAY_MS = 2_000;
export const BACKGROUND_MAX_DELAY_MS = 30_000;
export const BACKGROUND_TIMEOUT_MS = 10 * 60_000;
/** The absolute ceiling, independent of how often new work re-arms the quiet
 *  window: a probe holds the session out of the idle reclaim, so an agent
 *  reporting a tool every minute must not keep it alive forever. One hour is
 *  the precedent `turn-silence.ts` already set. */
export const BACKGROUND_MAX_LIFETIME_MS = 60 * 60_000;
export const BACKGROUND_LOAD_TIMEOUT_MS = 120_000;

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

export interface AcpBackgroundProbeOptions {
  /** Replay the session — `session/load` on the live process. */
  load: () => Promise<unknown>;
  /** A probe is a sign the session is still wanted. */
  resetIdle: () => void;
  /** The text past the answer already shown. */
  emit: (text: string) => void;
  timeoutMs?: number;
  firstDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export class AcpBackgroundProbe {
  private readonly load: () => Promise<unknown>;
  private readonly resetIdle: () => void;
  private readonly emitNotice: (text: string) => void;
  private readonly timeoutMs: number;
  private readonly firstDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;

  private baseline = '';
  private collecting: ReplaySegment | null = null;
  /** The notice seen in the last replay; a repeated value is COMPLETE. */
  private pendingNotice: string | null = null;
  private timer: unknown = null;
  private deadline = 0;
  /** When this probe began, for the absolute ceiling. */
  private beganAt = 0;
  private delay: number;
  private stopped = true;
  private inFlight = false;
  /** Consecutive `session/load` failures; a lost agent is not retried forever. */
  private failures = 0;
  private queued: { baseline: string; known: string[] } | null = null;
  /** Tool calls already reported for this probe, so a notice is not repeated. */
  private reportedTools = new Set<string>();

  constructor(options: AcpBackgroundProbeOptions) {
    this.load = options.load;
    this.resetIdle = options.resetIdle;
    this.emitNotice = options.emit;
    this.timeoutMs = options.timeoutMs ?? BACKGROUND_TIMEOUT_MS;
    this.firstDelayMs = options.firstDelayMs ?? BACKGROUND_FIRST_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? BACKGROUND_MAX_DELAY_MS;
    this.now = options.now ?? Date.now;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
    this.delay = this.firstDelayMs;
  }

  /** Watch for the delayed answer to a turn that spawned background work.
   *
   *  `knownTools` are the ids the CLOSED message already shows: the replay
   *  repeats them, and reporting the turn's own `invoke_subagent` as "the
   *  subagent continued working" is noise the operator has already seen on the
   *  card (measured against a real agy chat). */
  start(baseline: string, knownTools: readonly string[] = []): void {
    this.baseline = baseline.trim();
    this.pendingNotice = null;
    this.reportedTools = new Set(knownTools);
    // A previous probe's load can still be running. Queue this turn instead of
    // interleaving two replays; the queued baseline starts when that load ends.
    if (this.inFlight) {
      this.queued = { baseline: this.baseline, known: [...this.reportedTools] };
      return;
    }
    this.stopped = false;
    this.beganAt = this.now();
    this.deadline = this.now() + this.timeoutMs;
    this.delay = this.firstDelayMs;
    this.failures = 0;
    this.arm();
  }

  stop(): void {
    this.stopped = true;
    this.queued = null;
    this.pendingNotice = null;
    if (this.timer !== null) {
      this.cancel(this.timer);
      this.timer = null;
    }
  }

  /**
   * Swallow one replay notification. Returns true when the notification is part
   * of a probe and must not reach the live session: a replay repeats the whole
   * conversation, so folding it would open rows the operator already has.
   */
  consume(method: string, params: Record<string, unknown>): boolean {
    if (!this.collecting || method !== 'session/update') return false;
    collectReplayFrame(this.collecting, params.update);
    return true;
  }

  private arm(): void {
    if (this.stopped) return;
    this.timer = this.schedule(() => {
      this.timer = null;
      void this.probe();
    }, this.delay);
  }

  private async probe(): Promise<void> {
    if (this.stopped || this.inFlight) return;
    this.inFlight = true;
    this.collecting = { text: '', sawUser: false, tools: [] };
    this.resetIdle();
    let failed = false;
    try {
      await this.load();
    } catch {
      // The agent may be gone or refuse `session/load`; a probe never reports
      // that as a turn failure. Stop rather than spinning against it.
      failed = true;
    } finally {
      this.inFlight = false;
    }
    const segment = this.collecting;
    this.collecting = null;

    if (this.stopped) {
      // A new prompt or a Stop already claimed the session; its own request is
      // what flushes the agent's held update.
    } else if (failed) {
      // A parked permission can outlive the load's request budget. Retry a few
      // times so approving the dialog still lets the notice through; a child
      // that really exited is stopped by `stop()` from the session's exit hook.
      this.failures += 1;
      if (this.failures >= 3 || this.now() >= this.deadline) {
        this.stopped = true;
      } else {
        this.delay = Math.min(this.delay * 2, this.maxDelayMs);
        this.arm();
      }
    } else {
      this.failures = 0;
      let toolNotice: string | null = null;
      // A replay that never reached a user chunk cannot be placed in the
      // conversation, so it is not a notice.
      const notice = segment?.sawUser ? backgroundNotice(this.baseline, segment.text) : null;
      if (notice !== null) {
        // The agent may still be writing: the first replay of a growing answer
        // is a PREFIX. Emit only once a replay repeats the same text, which is
        // the only completion signal ACP gives a replay.
        const stable = notice === this.pendingNotice;
        this.pendingNotice = notice;
        if (stable || this.now() >= this.deadline) {
          this.emitNotice(notice);
          this.stopped = true;
        } else {
          this.delay = this.firstDelayMs;
          this.arm();
        }
      } else if (segment?.sawUser && (toolNotice = newToolNotice(segment, this.reportedTools)) !== null) {
        // No new prose, but the child RAN something: deliver that and keep
        // watching — each new tool call is evidence the run is alive, so the
        // ceiling is re-armed instead of expiring under it.
        this.emitNotice(toolNotice);
        // New work re-arms the QUIET window, never the absolute ceiling.
        this.deadline = this.now() + this.timeoutMs;
        this.delay = Math.min(this.delay * 2, this.maxDelayMs);
        if (this.now() - this.beganAt >= BACKGROUND_MAX_LIFETIME_MS) this.stopped = true;
        else this.arm();
      } else if (this.now() >= this.deadline) {
        this.stopped = true;
      } else {
        this.delay = Math.min(this.delay * 2, this.maxDelayMs);
        this.arm();
      }
    }

    if (this.queued !== null) {
      const next = this.queued;
      this.queued = null;
      this.start(next.baseline, next.known);
    }
  }
}

function defaultSchedule(fn: () => void, ms: number): unknown {
  const handle = setTimeout(fn, ms);
  handle.unref?.();
  return handle;
}

function defaultCancel(handle: unknown): void {
  clearTimeout(handle as NodeJS.Timeout);
}
