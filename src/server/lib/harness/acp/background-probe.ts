/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The probe that follows a turn which handed work to a background subagent.
 *
 * Measured on agy 1.5.3: `invoke_subagent` returns immediately, the call is
 * marked `completed`, the agent writes "sedang membuatkan…", and
 * `session/prompt` resolves `end_turn` while the child still runs. The child's
 * answer is written to the agent's transcript but **no `session/update` frame
 * is sent while the connection is idle** — it is held until the next request
 * (google-antigravity/antigravity-cli#1461), so the operator saw a stopped chat.
 *
 * `session/load` is the pull this probe relies on: replay frames are collected
 * instead of folded, and the part past the answer already on screen becomes a
 * continuation. **Text is not the only evidence** — a real run replayed
 * `read_file` and a failed `run_command` with no new prose — so new tool calls
 * are reported too, and each one re-arms the quiet window.
 *
 * On antigravity 1.5.3 the replay stopped carrying the transcript: it answered
 * with session metadata only. The one request that still flushes the held
 * completion is `session/prompt`, so after `pullAfterMs` of quiet the probe
 * asks the agent to continue — ONE synthetic turn, not a prompt loop.
 *
 * Backs off 2s → 30s; gives up ten minutes past the last work evidence, an hour
 * after the turn regardless. Never invents a failure for an answer it missed.
 */

import { collectReplayFrame, newToolNotice, type ReplaySegment } from '@/server/lib/harness/acp/background-replay';
import { backgroundNotice } from '@/server/lib/harness/acp/background-work';

export const BACKGROUND_FIRST_DELAY_MS = 2_000;
export const BACKGROUND_MAX_DELAY_MS = 30_000;
export const BACKGROUND_TIMEOUT_MS = 10 * 60_000;
/** The absolute ceiling, independent of how often new work re-arms the quiet
 *  window: a probe holds the session out of the idle reclaim, so an agent
 *  reporting a tool every minute must not keep it alive forever. One hour is
 *  the precedent `turn-silence.ts` already set. */
export const BACKGROUND_MAX_LIFETIME_MS = 60 * 60_000;
export const BACKGROUND_LOAD_TIMEOUT_MS = 120_000;

/**
 * How long the replay path may stay silent before the probe ASKS the agent to
 * continue. One pull per background turn: an agent that is genuinely still
 * working gets that single nudge, not a loop of them.
 */
export const BACKGROUND_PULL_AFTER_MS = 30_000;

/** The synthetic turn the probe sends when the replay carries nothing. It is a
 *  REQUEST to resume, not a new instruction: the original prompt is already in
 *  the agent's context, and repeating it here would restart the work. */
export function backgroundPullPrompt(): string {
  return [
    'Check the background subagent you started and continue the original task.',
    'If it has not finished yet, wait for it to finish and then continue.',
    'Do not repeat completed steps and do not ask the user anything; finish the work.',
  ].join(' ');
}

export interface AcpBackgroundProbeOptions {
  /** Replay the session — `session/load` on the live process. */
  load: () => Promise<unknown>;
  /** A probe is a sign the session is still wanted. */
  resetIdle: () => void;
  /** The text past the answer already shown. */
  emit: (text: string) => void;
  /**
   * Ask the agent to continue. Sent only after `pullAfterMs` of quiet, once per
   * background turn; absent on a transport that has no prompt channel.
   */
  pull?: () => Promise<unknown> | unknown;
  pullAfterMs?: number;
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
  private readonly pull: (() => Promise<unknown> | unknown) | undefined;
  private readonly pullAfterMs: number;
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
  /** When to ask the agent to continue, and whether that already happened. */
  private pullAt = 0;
  private pulled = false;
  private queued: { baseline: string; known: string[] } | null = null;
  /** Tool calls already reported for this probe, so a notice is not repeated. */
  private reportedTools = new Set<string>();

  constructor(options: AcpBackgroundProbeOptions) {
    this.load = options.load;
    this.resetIdle = options.resetIdle;
    this.emitNotice = options.emit;
    this.pull = options.pull;
    this.pullAfterMs = options.pullAfterMs ?? BACKGROUND_PULL_AFTER_MS;
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
    this.pullAt = this.now() + this.pullAfterMs;
    this.pulled = false;
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
        // A nudge now would interrupt work that is demonstrably running.
        this.pullAt = this.now() + this.pullAfterMs;
        this.delay = Math.min(this.delay * 2, this.maxDelayMs);
        if (this.now() - this.beganAt >= BACKGROUND_MAX_LIFETIME_MS) this.stopped = true;
        else this.arm();
      } else if (this.now() >= this.deadline) {
        this.stopped = true;
      } else if (this.pull && !this.pulled && this.now() >= this.pullAt) {
        // The replay has carried nothing for the whole quiet window. ACP has no
        // pull for a subagent's result, and `session/load` demonstrably returns
        // metadata only on antigravity 1.5.3; the one request that flushes the
        // held completion is a prompt, so ask the agent to continue. Once per
        // background turn — a still-running child must not become a prompt loop.
        this.pulled = true;
        this.stop();
        try {
          await this.pull();
        } catch {
          // The agent is gone, or a turn claimed the slot between the check and
          // the send. The chat keeps its existing answer; nothing to report.
        }
        return;
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