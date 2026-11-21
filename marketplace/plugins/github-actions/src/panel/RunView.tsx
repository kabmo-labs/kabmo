/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One run, drilled.
 *
 * The page answers three questions in the order a reader asks them: how far has
 * it got, which job failed, and what did that job print. So the progress line
 * comes first, the job list second, and a job's log is read only when its row is
 * open — a run with 31 jobs costs one `jobs` read, not 31 log reads.
 *
 * The run's state is GitHub's, not a roll-up of the jobs: a cancelled run whose
 * jobs all say `cancelled` must not read as `neutral` when the host said
 * `cancelled` for the run itself. `progress.failing` is the roll-up, and it drives
 * which verbs are offered.
 */

import { useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, type Job, type LogInput, type LogTail, type RunDetail, type RunVerb } from '../protocol';
import { Actions } from './Actions';
import { LogView, type LogState } from './LogView';
import { age, duration, progressLabel, stateClass, stateLabel, stateMark } from './format';

interface RunViewProps {
  detail: RunDetail;
  root: string;
  repo: string;
  authenticated: boolean;
  actBusy: boolean;
  actError: string | null;
  actMessage: string | null;
  onBack: () => void;
  onAct: (verb: RunVerb) => void;
}

const NO_LOG: LogState = { loading: false, error: null, tail: null };

export function RunView({
  detail,
  root,
  repo,
  authenticated,
  actBusy,
  actError,
  actMessage,
  onBack,
  onAct,
}: RunViewProps) {
  const { run, jobs, progress } = detail;
  const [openJob, setOpenJob] = useState<number | null>(null);
  const [log, setLog] = useState<{ jobId: number | null; state: LogState }>({ jobId: null, state: NO_LOG });
  const read = useRpc<LogInput, LogTail>(RPC.log);

  const showLog = (job: Job, tail?: number): void => {
    setOpenJob(job.id);
    setLog({ jobId: job.id, state: { loading: true, error: null, tail: null } });
    void read
      .call({ root, repo, jobId: job.id, ...(tail ? { tail } : {}) })
      .then((outcome) => {
        setLog({
          jobId: job.id,
          state: outcome.ok
            ? { loading: false, error: null, tail: outcome.value as LogTail }
            : { loading: false, error: outcome.error.message, tail: null },
        });
      });
  };

  const verbs = {
    cancel: authenticated && run.state === 'pending',
    rerun: authenticated && run.state !== 'pending',
    rerunFailed: authenticated && progress.failing > 0,
  };
  const reason = authenticated ? null : 'Cancel and re-run need a token.';

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="flex items-center gap-2 border-b border-ink/10 px-3 py-1.5">
        <button
          type="button"
          onClick={onBack}
          data-run-back=""
          class="rounded border border-ink/15 px-1.5 py-0.5 text-[10.5px] text-ink/70 hover:bg-ink/5"
        >
          ← Runs
        </button>
        <span class={`font-mono text-[11px] ${stateClass(run.state)}`} aria-hidden="true">
          {stateMark(run.state)}
        </span>
        <span class="truncate text-[12px] font-medium text-ink">{run.name}</span>
        <span class="ml-auto font-mono text-[10px] text-ink/45">#{run.number}</span>
      </div>

      <div class="border-b border-ink/10 px-3 py-2">
        <p class="truncate text-[11px] text-ink/75">{run.title}</p>
        <p class="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-ink/45">
          <span>{stateLabel(run.state)}</span>
          <span>·</span>
          <span>{run.branch ?? '—'}</span>
          <span>·</span>
          <span>{run.event}</span>
          <span>·</span>
          <span>{run.actor}</span>
          <span>·</span>
          <span>{age(run.updatedAt)}</span>
        </p>
        <p class="mt-1 font-mono text-[10.5px] text-ink/60" data-run-progress="">
          {progressLabel(progress)}
        </p>
        {run.url ? (
          <a
            href={run.url}
            target="_blank"
            rel="noopener noreferrer"
            class="mt-0.5 inline-block text-[10.5px] text-ink/55 underline decoration-ink/25 hover:text-ink"
          >
            Open on GitHub
          </a>
        ) : null}
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        {jobs.length === 0 ? (
          <p class="px-3 py-2 text-[11px] text-ink/50">This run has no jobs yet.</p>
        ) : (
          jobs.map((job) => (
            <div key={job.id} class="border-b border-ink/5">
              <div class="flex items-center gap-1.5 px-3 py-1.5">
                <span class={`w-3 font-mono text-[11px] ${stateClass(job.state)}`} aria-hidden="true">
                  {stateMark(job.state)}
                </span>
                <button
                  type="button"
                  data-job={job.id}
                  onClick={() => (openJob === job.id ? setOpenJob(null) : setOpenJob(job.id))}
                  class="min-w-0 flex-1 truncate text-left text-[11.5px] text-ink hover:underline"
                >
                  {job.name}
                </button>
                <span class="flex-shrink-0 font-mono text-[10px] text-ink/40">
                  {duration(job.startedAt, job.completedAt)}
                </span>
                <button
                  type="button"
                  data-job-log={job.id}
                  onClick={() => showLog(job)}
                  class="flex-shrink-0 rounded border border-ink/15 px-1.5 py-0.5 text-[10px] text-ink/65 hover:bg-ink/5"
                >
                  Log
                </button>
              </div>
              {openJob === job.id && job.steps.length > 0 ? (
                <ol class="pb-1 pl-8 pr-3">
                  {job.steps.map((step) => (
                    <li key={step.number} class="flex items-center gap-1.5 py-[1px] font-mono text-[10px]">
                      <span class={`w-3 ${stateClass(step.state)}`} aria-hidden="true">
                        {stateMark(step.state)}
                      </span>
                      <span class="truncate text-ink/65">
                        {step.number}. {step.name}
                      </span>
                      <span class="ml-auto flex-shrink-0 text-ink/35">
                        {duration(step.startedAt, step.completedAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
              {openJob === job.id && log.jobId === job.id ? (
                <LogView
                  state={log.state}
                  onFull={() => showLog(job, 2 * 1024 * 1024)}
                  onReload={() => showLog(job)}
                />
              ) : null}
            </div>
          ))
        )}
      </div>

      <Actions
        verbs={verbs}
        reason={reason}
        busy={actBusy}
        running={jobs.filter((job) => job.state === 'pending').length}
        total={jobs.length}
        onAct={onAct}
      />
      {actMessage ? <p class="px-3 py-1.5 text-[10.5px] text-ink/65">{actMessage}</p> : null}
      {actError ? <p class="px-3 py-1.5 text-[10.5px] text-error-text">{actError}</p> : null}
    </div>
  );
}
