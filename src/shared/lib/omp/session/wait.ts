/**
 * @license
 * SPDX-License-Identifier: MIT
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
 *   { op:'wait', from:<sender>, waited:[{from,to,body,ts}] }  // omp ≤18.18.6 only
 *   { op:'cancel', jobs:[...], cancelled:[{id,status}] }
 *
 * omp 18.18.9 removed `waited`: a message that ends the wait is handed to the
 * session, which injects it as its own `irc:incoming` turn, and the wait answers
 * with `interrupted:true` and the prose "Wait interrupted by message." The field
 * is still read because a session recorded on an older omp keeps it in its JSONL.
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
  /** What the job is for, in the MODEL's words — the `i` intent of the call
   *  that started it (omp 18.15.0); absent on subagent tasks and on a call the
   *  model gave no intent. */
  intent?: string;
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
  /** The messages a wake consumed, oldest first (omp 18.17.0 returns an array;
   *  a session recorded earlier carries one object, which is still read). */
  waited: WaitMessage[];
  /** The message a `send` delivered to, for the `send` op. */
  from?: string;
  to?: string;
  /**
   * Whether `details` carried the `op` that identifies a coordination result.
   *
   * False for a wait the runtime has not reported a snapshot for yet — a call
   * still blocking after a page reload, whose transcript carries only the
   * `toolCall` block — and for omp's own `details: {}` on "Nothing to wait
   * for". The view is still a wait (the tool's own name says so), but its job
   * list is UNKNOWN rather than empty, so no reader may claim "no jobs".
   */
  reported: boolean;
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
    intent: asString(value.intent),
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

/**
 * The messages a wake consumed, oldest first.
 *
 * omp 18.17.0 changed the field from ONE message to an ARRAY — a wake returns
 * every message queued by then (`messageResult(senderId, waited: IrcMessage[])`)
 * — and the old single-object shape is still read, because a session recorded
 * on 18.16.0 keeps it in its JSONL. Reading only the array dropped the message
 * block and the `message received` chip on every new wait, silently: `isRecord`
 * refuses an array, so the old code answered `undefined` rather than failing.
 *
 * omp 18.18.9 stopped producing the field altogether (see the module header).
 * These rows survive for sessions recorded before that, where the message has
 * no independent transcript turn to render instead.
 */
function messagesOf(value: unknown): WaitMessage[] {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map(messageOf).filter(Boolean) as WaitMessage[];
}

const WAIT_OPS: Record<string, true> = { wait: true, send: true };

/** The tool names that ARE a coordination call, independent of their result. */
const WAIT_TOOL_NAMES: Record<string, true> = { wait: true };

/** The op a tool's own name implies, for a call whose result reports none. */
function opOfTool(tool: { name?: string; type?: string }): string | undefined {
  const raw = (tool.name || tool.type || '').toLowerCase();
  return WAIT_TOOL_NAMES[raw] ? raw : undefined;
}

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
 * `{op:'wait', jobs:[]}` when the call ran out its idle window with nothing new
 * ("No reply within 10s."), when a service rather than a job woke the call, and
 * when every agent asked can no longer answer. Rejecting it drew the most
 * interesting wait of all as a generic card.
 *
 * A wait with NO result at all is still a wait, and the tool's own name is the
 * only evidence left — a page reloaded while the call blocks reads the JSONL's
 * `toolCall` block with no `toolResult` behind it, and omp's own
 * "Nothing to wait for" answers `details: {}`. Requiring `details.op` there
 * degraded the card to a generic Output block, which is the reported "wait
 * rendered as general after a reload". Such a view is marked `reported: false`
 * so nothing claims a job count it does not have.
 */
export function waitViewOf(tool: {
  details?: Record<string, unknown>;
  name?: string;
  type?: string;
}): WaitView | undefined {
  const details = isRecord(tool.details) ? tool.details : undefined;
  const reportedOp = details ? asString(details.op) : undefined;
  const op = reportedOp ?? opOfTool(tool);
  if (!op || !WAIT_OPS[op]) return undefined;
  if (!details) {
    return { op, jobs: [], agents: [], interrupted: false, cancelled: [], waited: [], reported: false };
  }

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
    waited: details.waited === undefined ? [] : messagesOf(details.waited),
    from: asString(details.from),
    to: asString(details.to),
    reported: reportedOp !== undefined,
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
