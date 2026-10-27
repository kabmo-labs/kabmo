/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `proc://` card body: a background job, a project service, a live agent,
 * or the listing of all three.
 *
 * omp's `proc://` device is reached through ordinary `read`/`write` transport
 * with a `proc://` path, so before this existed the timeline drew a dev server
 * as a FILE: `write proc://kabmo-dev/kill` opened the `edit` panel (its
 * stdin payload rendered as "Written File Preview"), and `read proc://ompdev`
 * opened the `read` panel with `javascript` as the file kind and the service
 * log as file contents. Every fact the result carries — state, pid, uptime,
 * restart count, exit code, persist/detached — sat unused in `details.proc`.
 *
 * This panel is also the legacy `hub` tool's renderer (see `registry.ts`): the
 * two report the same `details`, and omp replaced `hub` with `proc://`.
 */

import { useMemo } from 'preact/hooks';
import type { ReactNode } from 'preact/compat';
import { Activity, CheckCircle2, CircleSlash, Loader2, Radio, Server, Terminal } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { stripAnsiCodes } from '@/shared/lib/code/ansi';
import {
  daemonTone,
  formatProcDuration,
  jobTone,
  procOpLabel,
  procUptime,
  procViewOf,
  type ProcAgent,
  type ProcDaemon,
  type ProcJob,
} from '@/shared/lib/omp/session/proc';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { ToolPanelHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolPanelHeader';
import { jobProgressLine } from '@/shared/lib/omp/session/job-progress';

/** Tone → class list. A toned chip is text-only; the ink palette has no room
 *  for a filled pill in a dense row. */
const TONE_CLASSES = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
  muted: 'text-ink/50',
} as const;

function ToneDot({ tone, pulse = false }: { tone: keyof typeof TONE_CLASSES; pulse?: boolean }) {
  const color =
    tone === 'ok' ? 'bg-success' : tone === 'warn' ? 'bg-warning' : tone === 'error' ? 'bg-error' : 'bg-ink/35';
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${color}${pulse ? ' animate-pulse' : ''}`} />;
}

/** One label/value pair in the process fact strip. */
function Fact({ label, value, tone }: { label: string; value: string | number; tone?: keyof typeof TONE_CLASSES }) {
  return (
    <span className="text-ink/45">
      {label} <strong className={tone ? TONE_CLASSES[tone] : 'text-ink'}>{value}</strong>
    </span>
  );
}

/** Every fact a daemon snapshot carries, in the order a reader wants them. */
function DaemonFacts({ daemon, now }: { daemon: ProcDaemon; now: number }) {
  const uptime = procUptime(daemon, now);
  const tone = daemonTone(daemon.state);
  const exited = typeof daemon.exitedAt === 'number';
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-1 font-mono text-[10.5px]">
      {daemon.state && (
        <span className={`inline-flex items-center gap-1.5 font-semibold ${TONE_CLASSES[tone]}`}>
          <ToneDot tone={tone} pulse={!exited && (daemon.state === 'starting' || daemon.state === 'restarting')} />
          {daemon.state}
        </span>
      )}
      {daemon.pid !== undefined && <Fact label="pid" value={daemon.pid} />}
      {uptime && <Fact label={exited ? 'ran' : 'up'} value={uptime.label} />}
      {daemon.exitCode !== undefined && (
        <Fact label="exit" value={daemon.exitCode} tone={daemon.exitCode === 0 ? 'ok' : 'error'} />
      )}
      {daemon.restartCount !== undefined && daemon.restartCount > 0 && <Fact label="restarts" value={daemon.restartCount} />}
      {daemon.persist && <Fact label="mode" value="persistent" />}
      {daemon.detached && <Fact label="mode" value="detached" />}
    </div>
  );
}

/** A job row: status, id, type, what it runs, how long it has run. */
function JobRow({ job }: { job: ProcJob }) {
  const tone = jobTone(job.status);
  const running = job.status === 'running';
  const duration = typeof job.durationMs === 'number' ? formatProcDuration(job.durationMs) : undefined;
  // This row has no percent chip, so the line carries the estimate itself.
  const progress = jobProgressLine(job, { includePercent: true });
  return (
    <div className="space-y-0.5 px-3 py-1.5">
      <div className="flex items-center gap-2 text-[11.5px]">
        {running ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-ink/50" />
        ) : job.status === 'failed' ? (
          <CircleSlash size={11} className="shrink-0 text-error" />
        ) : job.status === 'cancelled' ? (
          <CircleSlash size={11} className="shrink-0 text-warning" />
        ) : (
          <CheckCircle2 size={11} className="shrink-0 text-success" />
        )}
        {job.id && <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/80">{job.id}</span>}
        {job.type && (
          <span className="shrink-0 rounded bg-ink/5 px-1 py-0.2 font-mono text-[8.5px] uppercase tracking-wider text-ink/45">
            {job.type}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-ink/85" title={job.label}>
          {job.label ?? job.resultText ?? job.errorText ?? ''}
        </span>
        {job.resolvedModel && (
          <span className="hidden max-w-[120px] truncate font-mono text-[9px] text-ink/40 sm:inline-block">
            {job.resolvedModel}
          </span>
        )}
        {duration && <span className="shrink-0 font-mono text-[9px] text-ink/40">{duration}</span>}
        {job.status && (
          <span className={`shrink-0 font-mono text-[9px] font-semibold ${TONE_CLASSES[tone]}`}>{job.status}</span>
        )}
      </div>
      {progress && <div className="truncate font-mono text-[9px] text-ink/40">{progress}</div>}
    </div>
  );
}

/** A service row in the listing: name, state, pid, uptime. */
function DaemonRow({ daemon, now }: { daemon: ProcDaemon; now: number }) {
  const tone = daemonTone(daemon.state);
  const uptime = procUptime(daemon, now);
  const exited = typeof daemon.exitedAt === 'number';
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
      <Server size={11} className="shrink-0 text-ink/50" />
      <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/80">{daemon.name}</span>
      <span className={`shrink-0 font-mono text-[9px] font-semibold ${TONE_CLASSES[tone]}`}>{daemon.state}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-ink/40" title={daemon.readyMatch}>
        {daemon.pid !== undefined ? `pid ${daemon.pid}` : ''}
      </span>
      {uptime && (
        <span className="shrink-0 font-mono text-[9px] text-ink/40">
          {exited ? 'ran ' : 'up '}
          {uptime.label}
        </span>
      )}
    </div>
  );
}

/** A live agent the session registered outside its jobs. */
function AgentRow({ agent }: { agent: ProcAgent }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
      <Radio size={11} className={`shrink-0 ${agent.live ? 'animate-pulse text-ink/60' : 'text-warning'}`} />
      <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/80">{agent.id}</span>
      <span className="min-w-0 flex-1 truncate text-ink/85">{agent.activity ?? 'agent'}</span>
      {typeof agent.ageMs === 'number' && (
        <span className="shrink-0 font-mono text-[9px] text-ink/40">{formatProcDuration(agent.ageMs)}</span>
      )}
    </div>
  );
}

function Group({ label, count, children }: { label: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-ink/8">
      <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-3 py-1.5">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">{label}</span>
        <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[9.5px] text-ink/45">{count}</span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1">{children}</div>
    </div>
  );
}

/** Log lines, ANSI stripped: omp hands the service log in terminal-formatted
 *  rows, and the panel is not a terminal. */
function LogBlock({ lines }: { lines: string[] }) {
  if (lines.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-ink/40">
        <Terminal size={11} className="text-ink/40" />
        <span>Log</span>
        <span className="font-mono text-[9px] text-ink/35">{lines.length} lines</span>
      </div>
      <div className="max-h-72 overflow-auto rounded-lg border border-ink/8 bg-paper px-3 py-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words text-ink/80 select-text">
        {lines.map((line, index) => (
          <div key={index}>{line}</div>
        ))}
      </div>
    </div>
  );
}

/** Panel untuk tool `read`/`write` dengan path `proc://` (dan legacy `hub`). */
export function Proc({ tool }: { tool: ToolCallData }) {
  const view = useMemo(() => procViewOf(tool), [tool]);
  const output = tool.output || (tool.error ? `Error: ${tool.error}` : '');
  const now = useMemo(() => Date.now(), []);

  const logLines = useMemo(() => {
    if (!view) return [];
    const rows = view.terminalRows && view.terminalRows.length > 0 ? view.terminalRows : undefined;
    const raw = rows ?? (view.log ? view.log.split(/\r?\n/) : []);
    return raw.map((line) => stripAnsiCodes(line)).filter((line) => line.trim());
  }, [view]);

  if (!view) return output ? <FallbackOutput text={output} /> : null;

  const op = procOpLabel(view.op);
  const name = view.daemon?.name ?? view.job?.id ?? view.id ?? '';
  const isListing = !view.daemon && !view.job && !view.id;
  const listed = view.jobs.length + view.daemons.length + view.agents.length;

  return (
    <div className="space-y-2.5">
      <ToolPanelHeader
        icon={<Server size={12} />}
        label={isListing ? 'Jobs & services' : name || 'Process'}
        badge={op}
        copyText={output || undefined}
        copyLabel="Copy output"
      />

      {/* A single service or job the call named. */}
      {view.daemon && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="divide-y divide-ink/[0.04] px-3 py-2">
            <DaemonFacts daemon={view.daemon} now={now} />
            {view.input !== undefined && (
              <div className="pt-2">
                <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">Stdin</span>
                <div className="mt-1 rounded border border-ink/6 bg-canvas/40 p-2 font-mono text-[10.5px] whitespace-pre-wrap break-all text-ink/80">
                  {view.input.trim() || '(Enter)'}
                </div>
              </div>
            )}
            {view.mode && <div className="pt-2 text-[11px] text-ink/70">Mode set to <strong className="font-mono text-ink">{view.mode}</strong></div>}
          </div>
        </div>
      )}

      {view.job && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper py-1">
          <JobRow job={view.job} />
        </div>
      )}

      {/* A `/kill` on a background job answers with the outcomes. */}
      {view.cancelled.length > 0 && (
        <Group label="Cancelled" count={view.cancelled.length}>
          {view.cancelled.map((outcome, index) => {
            const job = view.jobs.find((row) => row.id === outcome.id);
            const tone = jobTone(outcome.status);
            return (
              <div key={`${outcome.id ?? index}`} className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
                <CircleSlash size={11} className="shrink-0 text-warning" />
                <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/80">{outcome.id ?? 'job'}</span>
                <span className="min-w-0 flex-1 truncate text-ink/70" title={job?.label}>
                  {job?.label ?? ''}
                </span>
                <span className={`shrink-0 font-mono text-[9px] font-semibold ${TONE_CLASSES[tone]}`}>
                  {outcome.status}
                </span>
              </div>
            );
          })}
        </Group>
      )}

      {/* The listing (`read proc://`) and any service list a call returned. */}
      <Group label="Services" count={view.daemons.length}>
        {view.daemons.map((daemon, index) => (
          <DaemonRow key={`${daemon.id ?? index}`} daemon={daemon} now={now} />
        ))}
      </Group>
      <Group label="Jobs" count={view.jobs.length}>
        {view.jobs.map((job, index) => (
          <JobRow key={`${job.id ?? index}`} job={job} />
        ))}
      </Group>
      <Group label="Agents" count={view.agents.length}>
        {view.agents.map((agent, index) => (
          <AgentRow key={`${agent.id ?? index}`} agent={agent} />
        ))}
      </Group>

      <LogBlock lines={logLines} />

      {isListing && listed === 0 && !output && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink/15 px-3 py-2.5 text-[11.5px] text-ink/45">
          <Activity size={13} className="shrink-0" />
          <span>No background jobs or services</span>
        </div>
      )}

      {/* A listing's prose, or a message the structured rows do not carry.
          A named process is NOT echoed as raw text: omp's own card shows the
          snapshot, and printing `Started kabmo: ready pid=43148 …` under
          the facts that already say `ready · pid 43148` is the same sentence
          twice. A failed call still shows its reason. */}
      {isListing && output && <FallbackOutput text={output} />}
      {!isListing && (tool.error || tool.isError) && output && <FallbackOutput text={output} />}
    </div>
  );
}
