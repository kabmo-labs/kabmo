/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Work an ACP agent keeps doing AFTER it has answered `session/prompt`.
 *
 * antigravity's `invoke_subagent` returns immediately: the tool call is marked
 * `completed`, the agent says "sedang membuatkan…", and `session/prompt`
 * resolves with `end_turn` while the subagent is still running. Measured on agy
 * 1.5.3, the subagent's later completion and the agent's follow-up answer are
 * written to its transcript but **no `session/update` frame is sent while the
 * connection is idle**; the frames are held until the next request (upstream
 * issue google-antigravity/antigravity-cli#1461). The operator then sees a
 * stopped chat with no notice.
 *
 * `session/load` is the one request that replays that transcript, so the turn
 * that spawned the subagent is followed by a load probe: replay frames are
 * collected instead of folded (they repeat the whole chat), and the text past
 * the answer the operator already has is emitted as the agent's continuation.
 *
 * The probe backs off (2s → 30s) and gives up after ten minutes; it never
 * substitutes a failure for an answer it did not see.
 */

import { acpContentText } from '@/server/lib/harness/acp/mapper';
import { stampMessageModel } from '@/server/lib/harness/acp/session-config';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';
import type { AgentEvent } from '@/server/lib/omp/rpc/constants';

/** Tool names that hand work to a process the turn does not await. */
const BACKGROUND_TOOLS: Record<string, true> = {
  invoke_subagent: true,
  spawn_subagent: true,
};

export const BACKGROUND_FIRST_DELAY_MS = 2_000;
export const BACKGROUND_MAX_DELAY_MS = 30_000;
export const BACKGROUND_TIMEOUT_MS = 10 * 60_000;
export const BACKGROUND_LOAD_TIMEOUT_MS = 120_000;

/** Did this turn hand work to a background worker? Read from the closed
 *  assistant message, which is the only place the tool call survives. */
export function spawnsBackgroundWork(message: unknown): boolean {
  if (!message || typeof message !== 'object' || !('content' in message)) return false;
  const content = message.content;
  if (!Array.isArray(content)) return false;
  return content.some((block) => {
    if (!block || typeof block !== 'object') return false;
    if (!('type' in block) || block.type !== 'toolCall') return false;
    return 'name' in block && typeof block.name === 'string' && BACKGROUND_TOOLS[block.name.toLowerCase()] === true;
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

/** Replay chunks collected since the last `user_message_chunk`. */
interface ReplaySegment {
  text: string;
  sawUser: boolean;
}

/**
 * The load probe for one background turn.
 *
 * `consume` must be called for every notification while a probe is in flight:
 * the replay repeats the whole transcript, and folding it into the live chat
 * would duplicate history.
 */
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
  private delay: number;
  private stopped = true;
  private inFlight = false;
  /** Consecutive `session/load` failures; a lost agent is not retried forever. */
  private failures = 0;
  private queued: string | null = null;

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

  /** Watch for the delayed answer to a turn that spawned background work. */
  start(baseline: string): void {
    this.baseline = baseline.trim();
    this.pendingNotice = null;
    // A previous probe's load can still be running. Queue this turn instead of
    // interleaving two replays; the queued baseline starts when that load ends.
    if (this.inFlight) {
      this.queued = this.baseline;
      return;
    }
    this.stopped = false;
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
    const update = params.update;
    if (!update || typeof update !== 'object') return true;
    const record = update as Record<string, unknown>;
    const kind = typeof record.sessionUpdate === 'string' ? record.sessionUpdate : '';
    if (kind === 'user_message_chunk') {
      // A new user turn starts a new assistant segment. Everything before it is
      // history this probe does not need.
      this.collecting.text = '';
      this.collecting.sawUser = true;
      return true;
    }
    if (kind === 'agent_message_chunk') {
      this.collecting.text += acpContentText(record.content);
    }
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
    this.collecting = { text: '', sawUser: false };
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
      } else if (this.now() >= this.deadline) {
        this.stopped = true;
      } else {
        this.delay = Math.min(this.delay * 2, this.maxDelayMs);
        this.arm();
      }
    }

    if (this.queued !== null) {
      const baseline = this.queued;
      this.queued = null;
      this.start(baseline);
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
