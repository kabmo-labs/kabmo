/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One command, as a row that expands into its own output.
 *
 * The shape is the git panel's `StashSection`, deliberately: `.section-reveal`
 * (`grid-template-rows: 0fr → 1fr`) is Kabmo's one disclosure animation,
 * the toggle is a full-width `<button>` carrying `aria-expanded`/`aria-controls`,
 * and the body stays MOUNTED and `inert` while collapsed so the reveal has
 * something to animate without leaving a hidden control tabbable.
 *
 * ## The disclosure is ENABLED only when there is output
 *
 * A command that has never run has nothing to expand, so its toggle is disabled
 * and says why in its title. An expandable row that opens onto "nothing here"
 * teaches the reader that the control is unreliable; a disabled one teaches them
 * exactly what the state is. The row still offers Run, so the way to get output
 * is visible.
 *
 * ## There is no output toggle any more
 *
 * There were two per-command toggles (`output`, `background`). The output one is
 * GONE: expanding the row already shows the output, so a toggle that only decided
 * whether the row was open by default was a second control for one thing — and a
 * row that opened itself because a toggle was on fought the reader who had just
 * closed it. What remains is the background toggle, which is a real choice about
 * how a run is TRACKED rather than about what is displayed.
 *
 * ## Which run a row shows
 *
 * The row's own LATEST run, matched by `commandId` — never by label or file,
 * which collide for two commands of the same name in one file.
 *
 * ## A user's own command gets two more controls
 *
 * Edit and Delete appear ONLY on a row that came from storage (`command.custom`),
 * because a command parsed out of a `package.json` has no Kabmo-side row to
 * edit — its file is the source, and the panel is not an editor for it. Both are
 * revealed on hover and always shown on a touch device, which is Kabmo's
 * `.touch-visible` convention: a control that exists only on hover is
 * unreachable on a phone.
 */

import { useEffect, useId, useState } from 'preact/hooks';

import type { Command, RunLog, RunSummary } from '../protocol';
import { Glyph, ICON } from './Glyph';
import { RunOutput } from './Output';

export interface CommandRowProps {
  command: Command;
  /** The repo-relative file this command came from, for the run's `file`. */
  file: string;
  /** This command's own latest run, or null when it never ran. */
  run: RunSummary | null;
  /** The log for that run, or null while the read is in flight. */
  log: RunLog | null;
  /** Track this command as a job (the `Background` toggle). */
  background: boolean;
  onToggleBackground: (commandId: string, next: boolean) => void;
  onRun: (commandId: string) => void;
  onStop: (runId: string) => void;
  /** The panel's own re-read of a run's log. */
  onReadLog: (runId: string) => void;
  /** Open the dialog on this stored command. Absent for a file's commands. */
  onEdit?: (command: Command) => void;
  /** Remove this stored command. Absent for a file's commands. */
  onRemove?: (command: Command) => void;
}

/** What a run's state reads, in one short word for the row's chip. */
function stateLabel(run: RunSummary): string {
  if (run.status === 'running') return 'running';
  if (run.signal) return 'stopped';
  if (run.exitCode === null) return 'failed';
  return run.exitCode === 0 ? 'exit 0' : `exit ${run.exitCode}`;
}

/** The chip's tone: a finished failure is the only red thing on a row. */
function stateTone(run: RunSummary): string {
  if (run.status === 'running') return 'text-info';
  if (run.signal) return 'text-ink/50';
  if (run.exitCode === 0) return 'text-ink/50';
  return 'text-error';
}

export function CommandRow({
  command,
  file,
  run,
  log,
  background,
  onToggleBackground,
  onRun,
  onStop,
  onReadLog,
  onEdit,
  onRemove,
}: CommandRowProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();

  /**
   * There is something to show.
   *
   * A run exists as soon as it is STARTED (the topic carries it with
   * `status: 'running'` and zero bytes), so this is true for a live run too — the
   * expansion is where its output appears as it prints.
   */
  const hasOutput = run !== null;
  const showing = open && hasOutput;

  /**
   * Run, and OPEN the row once there is something in it.
   *
   * A Run whose output lands in a collapsed expansion looks like it did nothing —
   * verified: the run succeeded and the row stayed shut, so the only thing on
   * screen was an unchanged list. The open is deferred to the effect below rather
   * than done here, because at this moment the run does not exist yet and
   * `showing` would be forced false again on the next render.
   */
  const handleRun = () => onRun(command.id);

  // Open the row the moment this command's run appears — a run that just started
  // is a run the reader asked to see.
  useEffect(() => {
    if (hasOutput) setOpen(true);
  }, [hasOutput]);

  // Reading the log is what makes the expansion's content current, so it happens
  // when the body is actually shown and the run has produced bytes.
  useEffect(() => {
    if (!showing || !run) return;
    onReadLog(run.id);
    // Keyed on the byte count: a run that prints nothing costs no read, and a
    // streaming one costs one read per topic publish (throttled server-side).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showing, run?.id, run?.bytes]);

  const running = run?.status === 'running';

  return (
    <div className="border-b border-ink/5">
      <div className="group/row flex items-center gap-1 pr-3 hover:bg-ink/5 transition-colors">
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          disabled={!hasOutput}
          aria-expanded={showing}
          aria-controls={bodyId}
          title={
            hasOutput
              ? showing
                ? `Hide ${command.label} output`
                : `Show ${command.label} output`
              : `${command.label} has not run yet`
          }
          // An explicit accessible name, because a DISABLED control's `title` is
          // not announced by every reader and is not what `getByRole(name:)`
          // resolves — the state has to be readable, not only hoverable.
          aria-label={
            hasOutput
              ? `${showing ? 'Hide' : 'Show'} ${command.label} output`
              : `${command.label} has not run yet`
          }
          className="flex flex-1 min-w-0 items-center gap-1 py-1.5 pl-3 pr-2 text-left text-[11px] font-normal text-ink/80 hover:text-ink transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-ink/80"
        >
          {/* The change list's own disclosure mark, in `font-mono` so it is the
              same SIZE as the one in the git panel: the identical codepoint at
              the identical font-size measures a quarter smaller in the app's
              sans stack. Dimmed when there is nothing to open, so the disabled
              state is visible and not only announced. */}
          <span
            className={`w-3 text-center font-mono ${hasOutput ? '' : 'text-ink/20'}`}
            aria-hidden="true"
          >
            {showing ? '▾' : '▸'}
          </span>
          <span className="truncate" title={`${file} → ${command.label}`}>{command.label}</span>
          {run ? (
            <span className={`ml-auto flex-shrink-0 font-mono text-[10px] ${stateTone(run)}`}>{stateLabel(run)}</span>
          ) : null}
        </button>

        {/* Edit / Delete, only on a stored command. `touch-visible` is the
            Kabmo's own reveal: `opacity-0` at rest, forced visible by a
            coarse pointer, so a phone is not left with two invisible controls
            it can press but cannot see. */}
        {command.custom && onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(command)}
            title={`Edit ${command.label}`}
            aria-label={`Edit ${command.label}`}
            className="flex-shrink-0 p-1 rounded text-ink/35 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 touch-visible"
          >
            <Glyph path={ICON.edit} />
          </button>
        ) : null}

        {command.custom && onRemove ? (
          <button
            type="button"
            onClick={() => onRemove(command)}
            title={`Delete ${command.label}`}
            aria-label={`Delete ${command.label}`}
            className="flex-shrink-0 p-1 rounded text-ink/35 hover:text-error hover:bg-error/10 transition-colors cursor-pointer opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 touch-visible"
          >
            <Glyph path={ICON.trash} />
          </button>
        ) : null}

        {/* The one toggle left: how a run is TRACKED, not what is displayed. */}
        <button
          type="button"
          onClick={() => onToggleBackground(command.id, !background)}
          aria-pressed={background}
          /* The name must not begin with `Run`/`Stop` like the control beside
             it. It used to (`Run <label> as a background job …`), which gave two
             buttons in one row the same accessible name up to the suffix — so a
             screen reader announced two controls beginning "Run bun run dev",
             and the e2e spec had to disambiguate with `exact: true` to click the
             right one. A name that starts with what the button DOES
             (`Keep … running in the background`) is unambiguous for both. */
          aria-label={`Keep ${command.label} running in the background — currently ${background ? 'on' : 'off'}, click to turn ${background ? 'off' : 'on'}`}
          title={background ? `Stop tracking ${command.label} as a job` : `Run ${command.label} as a background job`}
          className={`flex-shrink-0 p-1 rounded transition-colors cursor-pointer ${
            background ? 'bg-ink text-paper' : 'text-ink/35 hover:text-ink hover:bg-ink/5'
          }`}
        >
          <Glyph path={ICON.background} />
        </button>

        {/* Run / Stop, icon-only. A running command's glyph is the square, so the
            one control says which of the two things a click will do. */}
        <button
          type="button"
          onClick={() => (running ? onStop(run!.id) : handleRun())}
          title={running ? `Stop ${command.label}` : `Run ${command.label}`}
          aria-label={running ? `Stop ${command.label}` : `Run ${command.label}`}
          className={`flex-shrink-0 p-1 rounded border transition-colors cursor-pointer ${
            running
              ? 'border-error/40 text-error hover:bg-error/10'
              : 'border-ink/20 text-ink/70 hover:text-ink hover:bg-ink/5'
          }`}
        >
          <Glyph path={running ? ICON.stop : ICON.play} />
        </button>
      </div>

      {/* Mounted in both states so the reveal animates; `inert` while hidden so
          the controls inside are not tabbable and not announced. The direct child
          carries no padding — `overflow: hidden` clips the content box, so padding
          there would leave a sliver visible under a collapsed row. */}
      <div className="section-reveal" data-expanded={showing} id={bodyId} inert={!showing}>
        <div>
          <RunOutput run={run} log={log} onStop={onStop} />
        </div>
      </div>
    </div>
  );
}
