/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `wait` card body: a stopwatch, a progress bar, and one row per job the
 * call blocked on.
 *
 * A `wait` is the only tool that can legitimately occupy minutes of a turn
 * while producing almost no output, so the card has to answer one question the
 * generic fallback could not: how long has this been going, and is anything
 * still moving. (omp 18.17.0 removed its 30-minute ceiling: a window from a
 * 5 s → 5 min ladder now ends the call, and the ladder climbs across back-to-back
 * idle waits.) Before this the call had NO panel (`toolPanelKind` returned
 * null) and rendered as `Wait` + a "Wait" header + an empty Output block, even
 * though omp reports the whole picture in `details` — every job's status, its
 * elapsed `durationMs`, a subagent's `completionPercent`, and whether the wait
 * was interrupted.
 *
 * Three rules make the progress bar honest:
 *
 * 1. **The bar only fills when a number can be filled from.** A running job's
 *    `completionPercent` is a subagent's SELF-ESTIMATE, and a `bash` job has
 *    none at all — so a bar is drawn from it when present, and otherwise the
 *    bar is INDETERMINATE (a sweeping band). Drawing a fabricated 50% for a
 *    command that reports nothing would be a number the reader cannot check.
 * 2. **The clock is the runtime's own measurement.** omp re-emits the snapshot
 *    every 500 ms with `durationMs = now - startTime`, so the value is the real
 *    elapsed span, not a client-side guess that survives a reload. A finished
 *    call has no snapshot to re-read, so it falls back to the span the fold
 *    measured (`tool.durationMs`).
 * 3. **The bar stops when the call does.** A settled wait draws a full track
 *    with no animation, so a scrollback never keeps a sweeping band over a
 *    finished call.
 */

import { useMemo } from 'preact/hooks';
import { CheckCircle2, CircleSlash, Hourglass, Loader2, MessageSquare, Radio, XCircle } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import {
  formatWaitClock,
  waitCounts,
  waitJobSpanMs,
  waitSummaryLine,
  waitViewOf,
  type WaitAgent,
  type WaitJob,
} from '@/shared/lib/omp/session/wait';
import { waitIdleLabel, waitIdleOf } from '@/shared/lib/omp/session/wait-idle';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { ToolPanelHeader } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/ToolPanelHeader';
import { ProgressTrack, useStopwatch } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/wait-parts';
import { jobSubject, jobProgressLine } from '@/shared/lib/omp/session/job-progress';

const TONE_CLASSES = {
  ok: 'text-success',
  warn: 'text-warning',
  error: 'text-error',
  muted: 'text-ink/50',
} as const;

function jobTone(status: string | undefined): keyof typeof TONE_CLASSES {
  if (status === 'completed') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'warn';
  return 'muted';
}

/** One job row: what it is for, its status, and how long it has run. */
function JobRow({ job }: { job: WaitJob }) {
  const tone = jobTone(job.status);
  const running = job.status === 'running';
  // omp 18.15.0 records the caller's intent on the job and leads its own rows
  // with it, so `bun run dev` is not what the reader sees first.
  const subject = jobSubject(job);
  const label = subject.primary ?? job.resultText ?? job.errorText ?? job.id ?? '';
  const percent = running ? job.completionPercent : undefined;
  // The percent is already a chip in this row, so the progress line leaves it out.
  const progress = jobProgressLine(job);
  return (
    <div className="space-y-1 px-3 py-2">
      <div className="flex items-center gap-2 text-[11.5px]">
        {running ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-ink/50" />
        ) : job.status === 'failed' ? (
          <XCircle size={11} className="shrink-0 text-error" />
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
        <span className="min-w-0 flex-1 truncate text-ink/85" title={label}>
          {label.split('\n')[0]}
        </span>
        {typeof percent === 'number' && (
          <span className="shrink-0 font-mono text-[10px] text-ink/60">{Math.round(percent)}%</span>
        )}
        {job.exitCode !== undefined && (
          <span className={`shrink-0 font-mono text-[10px] font-semibold ${job.exitCode === 0 ? TONE_CLASSES.ok : TONE_CLASSES.error}`}>
            exit {job.exitCode}
          </span>
        )}
        {typeof job.durationMs === 'number' && (
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink/40">
            {formatWaitClock(job.durationMs)}
          </span>
        )}
        {job.status && (
          <span className={`shrink-0 font-mono text-[10px] font-semibold ${TONE_CLASSES[tone]}`}>{job.status}</span>
        )}
      </div>
      {running && percent !== undefined && (
        <ProgressTrack percent={percent} active />
      )}
      {subject.secondary && (
        <div className="truncate font-mono text-[10px] text-ink/45" title={subject.secondary}>
          {subject.secondary.split('\n')[0]}
        </div>
      )}
      {progress && (
        <div className="truncate font-mono text-[10px] text-ink/40">{progress}</div>
      )}
      {job.resolvedModel && (
        <div className="truncate font-mono text-[10px] text-ink/40">{job.resolvedModel}</div>
      )}
    </div>
  );
}

/** A subagent the session runs outside its job rows — it never satisfies the
 *  wait, and omp's own card says so, so this panel does too. */
function AgentRow({ agent }: { agent: WaitAgent }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px]">
      <Radio size={11} className={`shrink-0 ${agent.live ? 'animate-pulse text-ink/60' : 'text-warning'}`} />
      <span className="shrink-0 font-mono text-[10px] font-semibold text-ink/80">{agent.id}</span>
      <span className="min-w-0 flex-1 truncate text-ink/85">{agent.activity ?? 'agent'}</span>
      {typeof agent.ageMs === 'number' && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink/40">{formatWaitClock(agent.ageMs)}</span>
      )}
    </div>
  );
}

/** Panel untuk tool `wait` (dan `send`, yang berbagi `CoordinationDetails`;
 *  `cancel`/`jobs` tetap milik `proc://`). */
export function Wait({ tool }: { tool: ToolCallData }) {
  const view = useMemo(() => waitViewOf(tool), [tool]);
  const output = tool.output || (tool.error ? `Error: ${tool.error}` : '');

  const running = tool.status === 'running';
  // The clock is the CALL's, never a watched job's: a job routinely starts
  // before the wait that watches it (measured on a real result — `bg_8` had run
  // 126 s while the `wait` call took 20 s). While the call blocks, omp reports no
  // span of its own, so it is counted from the call's start clock; once it
  // settles, the span measured by the fold wins. The job span is the last
  // resort, for a call whose start frame was missed.
  const jobSpan = view ? waitJobSpanMs(view) : undefined;
  const elapsed = useStopwatch(tool.startedAt, tool.durationMs ?? jobSpan, running && tool.durationMs === undefined);

  if (!view) return output ? <FallbackOutput text={output} /> : null;

  const counts = waitCounts(view);
  const summary = waitSummaryLine(view);
  // The bar's number comes from a subagent's own estimate, or from settled
  // jobs. With several jobs the average is what the call as a whole is doing.
  const estimates = view.jobs
    .filter((job) => job.status === 'running' && typeof job.completionPercent === 'number')
    .map((job) => job.completionPercent as number);
  // With a subagent estimate the bar shows that; otherwise it is INDETERMINATE.
  // Scaling it to the 30-minute cap was considered and rejected: a typical wait
  // settles in seconds, so the bar would sit at 0.1% and read as broken, while
  // the sweep says "in progress" without claiming a position. The cap is stated
  // as TEXT beside the clock, which is the honest place for a ceiling.
  const percent = !running
    ? 100
    : estimates.length > 0
      ? estimates.reduce((sum, value) => sum + value, 0) / estimates.length
      : null;
  const interrupted = view.interrupted;
  // omp 18.17.0 removed the 30-minute ceiling, so there is no budget left to
  // count down to. What a settled call CAN report is the window it gave up
  // after, which omp states in its own sentence — without that the card called
  // an idle return "no jobs", i.e. "the call looked and found none".
  const idle = waitIdleOf(output);

  return (
    <div className="space-y-2.5">
      <ToolPanelHeader
        icon={<Hourglass size={12} />}
        label={view.op === 'wait' ? 'Waiting' : view.op}
        badge={running ? 'running' : idle ? 'idle' : interrupted ? 'interrupted' : tool.status === 'error' ? 'failed' : 'settled'}
        copyText={output || undefined}
        copyLabel="Copy output"
      />

      {/* The stopwatch: the one thing a blocking call has to say for itself. */}
      <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper px-3 py-2.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[22px] font-semibold leading-none tabular-nums text-ink">
            {elapsed !== undefined ? formatWaitClock(elapsed) : '–'}
          </span>
          <span className="text-[10.5px] text-ink/45">{running ? 'waiting' : 'waited'}</span>
          {interrupted && (
            <span className={`ml-auto font-mono text-[10px] font-semibold uppercase tracking-wider ${TONE_CLASSES.warn}`}>
              interrupted
            </span>
          )}
          {!running && idle && (
            <span
              className={`ml-auto font-mono text-[10px] font-semibold uppercase tracking-wider ${TONE_CLASSES.warn}`}
              title="omp returns a blocking wait when its window elapses, and the window climbs across back-to-back idle waits"
            >
              {waitIdleLabel(idle)}
            </span>
          )}
        </div>
        {summary && <div className="mt-1 font-mono text-[10px] text-ink/45">{summary}</div>}
        <div className="mt-2">
          <ProgressTrack percent={percent} active={running} />
        </div>
      </div>

      {/* The messages that ended the wait, oldest first — omp 18.17.0–18.18.6
          results only. Since 18.18.9 the message is its own `irc:incoming`
          turn (`IrcNotice`), and the wait carries `interrupted` instead. */}
      {view.waited.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper px-3 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
            <MessageSquare size={10} />
            <span>{view.waited.length === 1 ? 'Message' : `${view.waited.length} messages`}</span>
          </div>
          <div className="mt-1 space-y-1.5">
            {view.waited.map((message, index) => (
              <div key={`${message.ts ?? index}-${index}`}>
                {message.from && (
                  <div className="font-mono text-[10px] normal-case tracking-normal text-ink/55">from {message.from}</div>
                )}
                <div className="whitespace-pre-wrap break-words text-[11.5px] text-ink/85">{message.body ?? ''}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view.jobs.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ink/8">
          <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">Jobs</span>
            <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">{counts.total}</span>
          </div>
          <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
            {view.jobs.map((job, index) => (
              <JobRow key={`${job.id ?? index}`} job={job} />
            ))}
          </div>
        </div>
      )}

      {view.agents.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-ink/8">
          <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">Agents</span>
            <span className="rounded-full bg-ink/5 px-1.5 py-px font-mono text-[10px] text-ink/45">{view.agents.length}</span>
          </div>
          <div className="divide-y divide-ink/6 bg-canvas/40 py-1">
            {view.agents.map((agent, index) => (
              <AgentRow key={`${agent.id ?? index}`} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {/* A call whose result was never written — a run that died mid-call, so
          not even omp's prose exists. Saying so is the honest answer; an empty
          body would read as a panel that failed to draw. */}
      {!running && !view.reported && !output && (
        <p className="font-mono text-[10.5px] text-ink/45">No result was recorded.</p>
      )}

      {/* The prose omp writes: a completion summary, a refusal ("Nothing to
          wait for…"), or the limit notice. It is the only place those
          sentences exist, so it is never dropped. */}
      {output && <FallbackOutput text={output} />}
    </div>
  );
}
