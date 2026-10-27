/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * oh-my-pi's `proc://` internal URL — the surface that replaced the legacy
 * `hub` tool for background jobs, project services and live agents.
 *
 * A call is ordinary `read`/`write` transport with a `proc://` path:
 *
 *   read  proc://              list every job, service and agent
 *   read  proc://<id>          one job's or service's status and log
 *   write proc://<id>          send stdin to a service (empty = Enter)
 *   write proc://<id>/kill     cancel a job/agent, or stop a service
 *   write proc://<id>/mode     persist | session | detached
 *
 * The result carries `details.proc` (measured shapes: `{action,daemon}`,
 * `{daemon,log,terminalRows}`, `{jobs,agents,daemons}`, `{job,log}`,
 * `{op:'cancel',jobs,cancelled}`, `{action,daemon,input|mode}`), and the
 * legacy `hub` tool carried the same data at the TOP level of `details`
 * (`{daemon}`, `{jobs}`, `{daemons}`). One reader for both, so the panel, the
 * card header, the fact chips and the activity phrase cannot disagree about
 * what a call did.
 *
 * Pure and DOM-free: both the live fold and the reload path reach it.
 */

import { isRecord } from '@/shared/lib/util/guards';

export const PROC_SCHEME = 'proc://';

/** The operation a `proc://<id>/<action>` path selects. */
export type ProcAction = 'read' | 'stdin' | 'mode' | 'kill';

export interface ProcTarget {
  /** Empty for the bare `proc://` listing. */
  id: string;
  action: ProcAction;
}

/** Parse a `proc://` path. Returns undefined for any other scheme. */
export function parseProcUrl(path: string | undefined): ProcTarget | undefined {
  if (!path || !path.startsWith(PROC_SCHEME)) return undefined;
  const rest = path.slice(PROC_SCHEME.length);
  // A query or hash is not part of the grammar omp accepts, and neither is a
  // deeper path: `proc://<id>/kill` is the only shape with a segment.
  const [head] = rest.split(/[?#]/);
  const slash = head.indexOf('/');
  const id = (slash === -1 ? head : head.slice(0, slash)).trim();
  const segment = slash === -1 ? '' : head.slice(slash + 1).replace(/\/+$/, '');
  return { id, action: segment === 'kill' ? 'kill' : segment === 'mode' ? 'mode' : 'read' };
}

/** The `proc://` path a call names, from its result target or its arguments. */
export function procPathOf(tool: { target?: string; input?: unknown }): string | undefined {
  if (tool.target && tool.target.startsWith(PROC_SCHEME)) return tool.target;
  const input = isRecord(tool.input) ? tool.input : undefined;
  const path = input?.path;
  return typeof path === 'string' && path.startsWith(PROC_SCHEME) ? path : undefined;
}

/** The call's `proc://` target, if it names one. */
export function procRequestOp(path: string | undefined, toolName: string | undefined): ProcAction {
  const target = parseProcUrl(path);
  if (!target) return 'read';
  // omp's grammar has no `/stdin` segment: a bare `proc://<id>` on the WRITE
  // transport sends stdin, and on the read transport reports status. The path
  // alone cannot tell the two apart, which is why the transport is an input.
  if (target.action === 'read' && target.id && (toolName ?? '').toLowerCase() === 'write') return 'stdin';
  return target.action;
}

export interface ProcDaemon {
  name?: string;
  id?: string;
  state?: string;
  pid?: number;
  createdAt?: number;
  startedAt?: number;
  readyAt?: number;
  exitedAt?: number;
  exitCode?: number;
  restartCount?: number;
  outputBytes?: number;
  readyMatch?: string;
  persist?: boolean;
  detached?: boolean;
}

export interface ProcJob {
  id?: string;
  type?: string;
  status?: string;
  label?: string;
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
  /** The stage a running task reports. */
  stage?: string;
  resolvedModel?: string;
  resultText?: string;
  errorText?: string;
}

export interface ProcAgent {
  id?: string;
  activity?: string;
  ageMs?: number;
  live?: boolean;
}

/** Everything one `proc://` result says, in one shape. */
export interface ProcView {
  /** The op to label the call with: omp's own word when the result carries one. */
  op: string;
  /** The process the call named (absent for the listing). */
  id?: string;
  daemon?: ProcDaemon;
  job?: ProcJob;
  jobs: ProcJob[];
  daemons: ProcDaemon[];
  agents: ProcAgent[];
  cancelled: { id?: string; status?: string }[];
  log?: string;
  terminalRows?: string[];
  /** Payload a `stdin` write sent. */
  input?: string;
  /** Mode a `/mode` write set. */
  mode?: string;
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

function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value.filter(isRecord) as T[]) : [];
}

function daemonOf(value: unknown): ProcDaemon | undefined {
  if (!isRecord(value)) return undefined;
  return {
    name: asString(value.name),
    id: asString(value.id),
    state: asString(value.state),
    pid: asNumber(value.pid),
    createdAt: asNumber(value.createdAt),
    startedAt: asNumber(value.startedAt),
    readyAt: asNumber(value.readyAt),
    exitedAt: asNumber(value.exitedAt),
    exitCode: asNumber(value.exitCode),
    restartCount: asNumber(value.restartCount),
    outputBytes: asNumber(value.outputBytes),
    readyMatch: asString(value.readyMatch),
    persist: asBoolean(value.persist),
    detached: asBoolean(value.detached),
  };
}

function jobOf(value: unknown): ProcJob | undefined {
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
    resultText: asString(value.resultText),
    errorText: asString(value.errorText),
  };
}

function agentOf(value: unknown): ProcAgent | undefined {
  if (!isRecord(value)) return undefined;
  return {
    id: asString(value.id),
    activity: asString(value.activity),
    ageMs: asNumber(value.ageMs),
    live: asBoolean(value.live),
  };
}

/**
 * Normalize a `proc://` result into `ProcView`.
 *
 * The nested `details.proc` bag wins over the top-level legacy `hub` keys, and
 * a key the nested bag omits still reads through to the top level — an omp
 * build that reports `jobs` beside `proc` is read the same way as one that
 * nests it.
 */
export function procViewOf(tool: {
  target?: string;
  input?: unknown;
  details?: Record<string, unknown>;
}): ProcView | undefined {
  const target = parseProcUrl(procPathOf(tool));
  const details = isRecord(tool.details) ? tool.details : {};
  const nested = isRecord(details.proc) ? details.proc : undefined;
  if (!target && !nested && !details.daemon && !details.jobs && !details.daemons) return undefined;

  const source = nested ?? details;
  const action = asString(source.action);
  const op = asString(source.op) ?? action ?? target?.action ?? 'read';

  return {
    op,
    id: asString(source.name) ?? (target?.id || undefined),
    daemon: daemonOf(source.daemon) ?? daemonOf(details.daemon),
    job: jobOf(source.job) ?? jobOf(details.job),
    jobs: asList<ProcJob>(source.jobs ?? details.jobs).map(jobOf).filter(Boolean) as ProcJob[],
    daemons: asList<ProcDaemon>(source.daemons ?? details.daemons).map(daemonOf).filter(Boolean) as ProcDaemon[],
    agents: asList<ProcAgent>(source.agents ?? details.agents).map(agentOf).filter(Boolean) as ProcAgent[],
    cancelled: asList<{ id?: string; status?: string }>(source.cancelled).map((row) => ({
      id: asString(row.id),
      status: asString(row.status),
    })),
    log: asString(source.log) ?? asString(details.log),
    terminalRows: Array.isArray(source.terminalRows)
      ? (source.terminalRows.filter((row): row is string => typeof row === 'string'))
      : undefined,
    input: asString(source.input),
    mode: asString(source.mode),
  };
}

/**
 * The service a `bash` launch created, from `details.service`.
 *
 * omp answers a service-launching `bash` with `{name, state, ready, timedOut,
 * pid}` — the same snapshot `proc://<id>` reports under `proc.daemon` — so a
 * service started by `bash` and one read back by `proc://` describe themselves
 * through one reader.
 */
export function bashServiceOf(tool: { details?: Record<string, unknown> }): ProcDaemon | undefined {
  const details = isRecord(tool.details) ? tool.details : undefined;
  return daemonOf(details?.service);
}

/** Tone for a daemon state — omp's own union, mapped to the ink palette. */
export function daemonTone(state: string | undefined): 'ok' | 'warn' | 'error' | 'muted' {
  switch (state) {
    case 'ready':
    case 'running':
      return 'ok';
    case 'failed':
      return 'error';
    case 'starting':
    case 'restarting':
    case 'stopping':
      return 'warn';
    default:
      return 'muted';
  }
}

/** Tone for a job status (`running | completed | failed | cancelled`). */
export function jobTone(status: string | undefined): 'ok' | 'warn' | 'error' | 'muted' {
  switch (status) {
    case 'completed':
      return 'ok';
    case 'failed':
      return 'error';
    case 'cancelled':
      return 'warn';
    case 'running':
      return 'muted';
    default:
      return 'muted';
  }
}

/** `1h 4m` / `12m 3s` / `840ms` — the scale a service lives on. */
export function formatProcDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m ${totalSeconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * How long a daemon has been up, or how long it ran before it exited. An
 * exited service's span is `exitedAt - startedAt`, never `now - startedAt` —
 * a service that died an hour ago has not been running for an hour.
 */
export function procUptime(daemon: ProcDaemon, now = Date.now()): { label: string; ms: number } | undefined {
  if (typeof daemon.startedAt !== 'number') return undefined;
  const end = typeof daemon.exitedAt === 'number' ? daemon.exitedAt : now;
  const ms = Math.max(0, end - daemon.startedAt);
  return { label: formatProcDuration(ms), ms };
}

/** One-word label for the op a call performed. */
export function procOpLabel(op: string): string {
  switch (op) {
    case 'stdin':
      return 'stdin';
    case 'stop':
    case 'kill':
      return 'stop';
    case 'mode':
      return 'mode';
    case 'cancel':
      return 'cancel';
    case 'list':
    case 'read':
      return 'list';
    default:
      return op;
  }
}
