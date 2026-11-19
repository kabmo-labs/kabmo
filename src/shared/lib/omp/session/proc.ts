/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * what a call did. The daemon snapshot itself is read in `proc-daemon.ts`,
 * which maps both the 19.0.0 `UnitSnapshot` and the broker snapshot before it.
 *
 * Pure and DOM-free: both the live fold and the reload path reach it.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { daemonOf, type ProcDaemon } from '@/shared/lib/omp/session/proc-daemon';

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

export interface ProcJob {
  id?: string;
  type?: string;
  status?: string;
  label?: string;
  /** What the job is for, in the MODEL's words — the `i` intent of the call
   *  that started it (omp 18.15.0). Absent on rows omp built before the
   *  release, on subagent tasks, and on a call the model gave no intent. */
  intent?: string;
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

function jobOf(value: unknown): ProcJob | undefined {
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
 * pid}`; `proc://<id>` reports a 19.0.0 `UnitSnapshot` under `proc.daemon`
 * (`key`, `pids`, `policy.hold`). Both describe themselves through one reader,
 * which reads either generation.
 */
export function bashServiceOf(tool: { details?: Record<string, unknown> }): ProcDaemon | undefined {
  const details = isRecord(tool.details) ? tool.details : undefined;
  return daemonOf(details?.service);
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
