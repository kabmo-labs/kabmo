/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The install's own console, opened from the row that is updating.
 *
 * A harness update is a background job now, so the dialog's spinner says that
 * *something* is running and nothing about what it is doing — and when a press
 * fails, "claude update failed" without the command's output is not actionable.
 * The worker already streams every step's stdout/stderr into the job record
 * (throttled to 400 ms), so this panel is only a view of that: the steps, and
 * the output, pinned to the newest line.
 *
 * It stays open after the run settles — the failure case is exactly when the log
 * matters — and the record it renders is the last one the card polled, so a
 * finished run keeps its output until another update replaces it.
 */

import { useEffect, useRef } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Ban, CheckCircle2, CircleDashed, Loader2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import type { HarnessUpdateJob, HarnessUpdateJobStep } from '@/shared/types/harness-update';

export interface UpdateLogDialogProps {
  job: HarnessUpdateJob;
  onClose: () => void;
}

/** The mark for one step's state. */
function StepMark({ state }: { state: HarnessUpdateJobStep['state'] }) {
  if (state === 'ok') return <CheckCircle2 size={12} className="shrink-0 text-ink/55" />;
  if (state === 'failed') return <Ban size={12} className="shrink-0 text-error" />;
  if (state === 'running') return <Loader2 size={12} className="shrink-0 animate-spin text-ink motion-reduce:animate-none" />;
  return <CircleDashed size={12} className="shrink-0 text-ink/25" />;
}

/** How the panel describes the run, in the same words the toast uses. */
function phaseLabel(job: HarnessUpdateJob): string {
  if (job.finishedAt === null) return 'Installing…';
  return job.ok ? 'Finished' : 'Failed';
}

export function UpdateLogDialog({ job, onClose }: UpdateLogDialogProps) {
  const output = useRef<HTMLPreElement | null>(null);
  const running = job.finishedAt === null;

  // Pin to the newest line while the worker streams. Without it the panel shows
  // the top of npm's output and the reason for a failure is always below the
  // fold.
  useEffect(() => {
    const node = output.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [job.output]);

  return createPortal(
    <Modal
      onClose={onClose}
      // Above About (`z-50`) — the log is opened FROM that card, not instead of it.
      zClass="z-[65]"
      maxWidthClass="max-w-3xl"
      ariaLabel={`Update log for ${job.label}`}
      header={
        <div className="flex min-w-0 items-center gap-3">
          {running
            ? <Loader2 size={15} className="shrink-0 animate-spin text-ink/70 motion-reduce:animate-none" />
            : <StepMark state={job.ok ? 'ok' : 'failed'} />}
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-ink">Updating {job.label}</h2>
            <p className="truncate font-mono text-[11px] text-ink/50">
              {phaseLabel(job)}
              {job.steps.length > 0 ? ` · ${job.steps.filter((step) => step.state === 'ok').length}/${job.steps.length} steps` : ''}
            </p>
          </div>
        </div>
      }
      footer={
        job.message ? (
          <div className="border-t border-ink/10 px-5 py-2.5">
            <p className="text-[11px] leading-4 text-ink/65">{job.message}</p>
          </div>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-col gap-3 px-5 py-4">
        {/* What the run will do, and what it is doing: the commands are the
            reader's way to repeat a step by hand after a failure. */}
        <ul className="space-y-1">
          {job.steps.map((step, index) => (
            <li key={`${step.part}-${index}`} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-3.5 items-center"><StepMark state={step.state} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] leading-4 text-ink">{step.part}</span>
                <span className="block break-all font-mono text-[10px] leading-[15px] text-ink/45">
                  {step.command}
                  {step.state === 'failed' && step.code !== null ? ` — exit ${step.code}` : ''}
                </span>
              </span>
              {/* One line per STATE, because a press can run two installs: the
                  reader has to see which half is done. */}
              <span className="shrink-0 text-[10px] leading-4 text-ink/40">{step.state}</span>
            </li>
          ))}
        </ul>

        {/* The output box scrolls on its own — the modal body must not, or the
            step list would scroll away from the log it explains. */}
        <pre
          ref={output}
          className="max-h-[38vh] min-h-[8rem] overflow-auto rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 font-mono text-[10px] leading-[15px] whitespace-pre-wrap break-all text-ink/75"
        >
          {job.output || (running ? 'Waiting for output…' : 'The commands printed nothing.')}
        </pre>
      </div>
    </Modal>,
    document.body,
  );
}
