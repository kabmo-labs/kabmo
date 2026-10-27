/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * oh-my-pi's `wait` tool — the call that BLOCKS until a background job or a
 * project service the agent started settles.
 *
 * Its result is `CoordinationDetails` (measured on 443 real results across the
 * author's session store):
 *
 *   { op:'wait', meta:{source:{type:'report',value:'background jobs snapshot'}},
 *     jobs:[{id,type,status,label,durationMs,exitCode?,completionPercent?,
 *            resolvedModel?,resolvedThinkingLevel?,resultText?,errorText?,
 *            agentUrlId?}] }
 *   { op:'wait', jobs:[], interrupted:true }            // cut short by a message
 *   { op:'wait', from:<sender>, waited:{from,to,body,ts} }  // a peer message woke it
 *   { op:'cancel', jobs:[...], cancelled:[{id,status}] }
 *
 * While the call is still blocking omp re-emits the SAME snapshot every 500 ms
 * (`PROGRESS_INTERVAL_MS`) with a fresh `durationMs`, so the elapsed clock is
 * the runtime's own measurement rather than a client-side guess.
 *
 * Pure and DOM-free: the live fold, the JSONL reload path, the card's fact
 * chips and the panel all read the call through this one function.
 */

import { isRecord } from '@/shared/lib/util/guards';

/** The operations that report through `CoordinationDetails`. */
export type WaitOp = 'wait' | 'send' | 'cancel' | 'jobs';

/** One background job (or subagent task) the wait watched. */
export interface WaitJob {
  id?: string;
  /** `bash` | `task` | `eval`. */
  type?: string;
  status?: string;
  label?: string;
  /** Elapsed time AT SNAPSHOT TIME — omp computes `now - startTime` while the
   *  job runs, so a live snapshot's value is the real elapsed clock. */
  durationMs?: number;
  exitCode?: number;
  /** Self-estimated completion of a subagent task (0–100). */
  completionPercent?: number;
  /** Model requests a RUNNING task has made (omp 18.13.0). */
  requests?: number;
  /** Spend of a running task, in USD (omp 18.13.0). */
  cost?: number;
  /** Context fill of a running task, and the window it fills (omp 18.13.0). */
  contextTokens?: number;
  contextWindow?: number;
  /** The stage a running task reports (`implementing`, …). */
  stage?: string;
  resolvedModel?: string;
  resolvedThinkingLevel?: string;
  advisor?: boolean;
  resultText?: string;
  errorText?: string;
  /** `agent://<id>` handle backing this job's artifacts. */
  agentUrlId?: string;
}

/** A live subagent the session registered outside its job rows. */
export interface WaitAgent {
  id?: string;
  parentId?: string;
  activity?: string;
  ageMs?: number;
  live?: boolean;
  acceptedAt?: number;
}

/** A peer (IRC) message that ended the wait. */
export interface WaitMessage {
  from?: string;
  to?: string;
  body?: string;
  ts?: number;
  replyTo?: string;
}

/** Everything one `wait` result says, in one shape. */
export interface WaitView {
  op: string;
  jobs: WaitJob[];
  agents: WaitAgent[];
  /** The wait was cut short by steering, a peer message or a completion notice. */
  interrupted: boolean;
  cancelled: { id?: string; status?: string }[];
  waited?: WaitMessage;
  /** The message a `send` delivered to, for the `send` op. */
  from?: string;
  to?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function jobOf(value: unknown): WaitJob | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    type: asString(value.type),
    status: asString(value.status),
    label: asString(value.label),
    durationMs: asNumber(value.durationMs),
    exitCode: asNumber(value.exitCode),
    completionPercent: asNumber(value.completionPercent),
    requests: asNumber(value.requests),
    cost: asNumber(value.cost),
    contextTokens: asNumber(value.contextTokens),
    contextWindow: asNumber(value.contextWindow),
    stage: asString(value.stage),
    resolvedModel: asString(value.resolvedModel),
    resolvedThinkingLevel: asString(value.resolvedThinkingLevel),
    advisor: asBoolean(value.advisor),
    resultText: asString(value.resultText),
    errorText: asString(value.errorText),
    agentUrlId: asString(value.agentUrlId),
  };
}

function agentOf(value: unknown): WaitAgent | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    parentId: asString(value.parentId),
    activity: asString(value.activity),
    ageMs: asNumber(value.ageMs),
    live: asBoolean(value.live),
    acceptedAt: asNumber(value.acceptedAt),
  };
}

function messageOf(value: unknown): WaitMessage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    from: asString(value.from),
    to: asString(value.to),
    body: asString(value.body),
    ts: asNumber(value.ts),
    replyTo: asString(value.replyTo),
  };
}

const WAIT_OPS: Record<string, true> = { wait: true, send: true };

/**
 * Normalize a `wait` result into `WaitView`, or undefined when the call is not
 * one of the coordination operations.
 *
 * The `op` is what decides, and it is the ONLY reliable discriminator: `hub` and
 * `proc://` results carry `jobs` too, and reading those here would draw a
 * process listing as a wait. Only `wait` and `send` are claimed — `cancel` and
 * `jobs` belong to `proc://` and are already read by `procViewOf`.
 *
 * An EMPTY job list is a real answer, not an absence: omp returns
 * `{op:'wait', jobs:[]}` when the 30-minute cap elapses ("Wait limit reached;
 * background work may still be running") and when a service rather than a job
 * woke the call. Rejecting it drew the most interesting wait of all as a
 * generic card.
 */
export function waitViewOf(tool: { details?: Record<string, unknown> }): WaitView | undefined {
  const details = isRecord(tool.details) ? tool.details : undefined;
  if (!details) return undefined;
  const op = asString(details.op);
  if (!op || !WAIT_OPS[op]) return undefined;

  return {
    op,
    jobs: Array.isArray(details.jobs) ? (details.jobs.map(jobOf).filter(Boolean) as WaitJob[]) : [],
    agents: Array.isArray(details.agents)
      ? (details.agents.map(agentOf).filter(Boolean) as WaitAgent[])
      : [],
    interrupted: details.interrupted === true,
    cancelled: Array.isArray(details.cancelled)
      ? details.cancelled.filter(isRecord).map((row) => ({ id: asString(row.id), status: asString(row.status) }))
      : [],
    waited: messageOf(details.waited),
    from: asString(details.from),
    to: asString(details.to),
  };
}

/**
 * The longest span any WATCHED JOB reports — how long the job itself has run.
 *
 * This is NOT how long the wait has blocked: a job started before the wait did
 * (measured on a real result: `bg_8` reported 126 s while the `wait` call that
 * watched it took 20 s). It is only a fallback for a call whose own span is
 * unknown, and the panel and the fact chips both prefer `tool.durationMs`.
 */
export function waitJobSpanMs(view: WaitView): number | undefined {
  let longest: number | undefined;
  for (const job of view.jobs) {
    if (typeof job.durationMs !== 'number') continue;
    if (longest === undefined || job.durationMs > longest) longest = job.durationMs;
  }
  return longest;
}

/** Running / settled counts, in the order a reader asks for them. */
export function waitCounts(view: WaitView): { total: number; running: number; failed: number; cancelled: number } {
  const counts = { total: view.jobs.length, running: 0, failed: 0, cancelled: 0 };
  for (const job of view.jobs) {
    if (job.status === 'running') counts.running++;
    else if (job.status === 'failed') counts.failed++;
    else if (job.status === 'cancelled') counts.cancelled++;
  }
  return counts;
}

/** `2 jobs · 1 running` — the line under the elapsed clock. */
export function waitSummaryLine(view: WaitView): string {
  const counts = waitCounts(view);
  const noun = counts.total === 1 ? 'job' : 'jobs';
  const parts: string[] = [];
  if (counts.total > 0) parts.push(`${counts.total} ${noun}`);
  if (counts.running > 0) parts.push(`${counts.running} running`);
  if (counts.failed > 0) parts.push(`${counts.failed} failed`);
  if (counts.cancelled > 0) parts.push(`${counts.cancelled} cancelled`);
  if (view.agents.length > 0) {
    parts.push(`${view.agents.length} agent${view.agents.length === 1 ? '' : 's'}`);
  }
  if (view.interrupted) parts.push('interrupted');
  return parts.join(' · ');
}

/** `0:07` / `1:23` / `1:02:03` — a stopwatch, not a duration phrase.
 *  A blocking call is watched second by second, so the digits must not
 *  re-flow between ticks: the format keeps a fixed width per scale. */
export function formatWaitClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0:00';
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

/**
 * How long a single `wait` call may block, as omp enforces it.
 *
 * Hardcoded in omp's own tool (`WAIT_MAX_MS = 30 * 60_000`, verified on 18.12.0)
 * and NOT a parameter: its schema is `type({})`, so the model cannot ask for
 * more. When the timer wins the race, omp returns `{op:'wait', jobs:[]}` and the
 * sentence "Wait limit reached; background work may still be running."
 *
 * The panel shows this because a blocking call is watched for minutes, and
 * without the ceiling a reader has no way to tell "still waiting" from "waiting
 * for something that can never arrive".
 */
export const WAIT_MAX_MS = 30 * 60_000;

/** The sentence omp returns when its own cap fired. Matched on the text because
 *  the result carries no flag for it — `jobs: []` is also what a service wake
 *  answers, and those two must not be reported as the same event. */
const WAIT_LIMIT_TEXT = /wait limit reached/i;

/**
 * Whether this result is the cap firing rather than a normal settle.
 *
 * Text is the only signal: measured across 443 real `wait` results, the
 * limit-reached answer and a service wake both carry `{op:'wait', jobs:[]}`,
 * and only the prose distinguishes them.
 */
export function waitHitLimit(view: WaitView, output: string | undefined): boolean {
  if (view.jobs.length > 0) return false;
  return WAIT_LIMIT_TEXT.test(output ?? '');
}
