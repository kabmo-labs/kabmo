/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One command's output, inside its own row's expansion.
 *
 * ## It is a CODE BLOCK, not a `<pre>`
 *
 * The output is a program's stdout: fixed-width, not prose, and long lines are
 * normal. It is drawn with Kabmo's own code-block treatment — the
 * `.code-block` shell (border `ink/15`, radius, `--theme-canvas`) plus the
 * `Fira Code` face and the 12px/1rem line box `tailwind.css` gives a rendered
 * code block — so a command's output and a fenced block in the chat look like the
 * same thing, because they are.
 *
 * Wrapping is ON (`whitespace-pre-wrap` + `break-all`) rather than the
 * horizontal scroll a code block usually takes: a build log's long line is
 * usually the interesting one, and a 334px panel with a horizontal scrollbar
 * hides it.
 *
 * ## The header names the outcome, and what is NOT shown
 *
 * A build can produce megabytes, the server keeps the last 256 KB in a ring and
 * one read returns a tail, so the numbers say `last 64 KB of 3.1 MB` rather than
 * presenting a window as the whole log. Three outcome shapes, and the SIGNAL one
 * is why this is not just `exit ${code}`: a killed child reports `exitCode: null`
 * with a signal, so rendering the null code as `exit 0` would report a `SIGTERM`ed
 * run as a success.
 *
 * ## The log follows its tail, until the reader scrolls up
 *
 * A live run's useful line is the last one, and the box is capped at `max-h-72`:
 * without a follow the reader sees only the first 72 units of a build and has to
 * drag the scrollbar after every publish. So the element sticks to the bottom
 * while the run prints — and STOPS sticking the moment the reader scrolls up,
 * because a view that yanks itself back down while someone reads an earlier
 * failure is worse than one that stops following. Scrolling back to the bottom
 * resumes it. A new run (a re-run of the same command) starts following again:
 * the old tail is gone, and the new run's output is what the reader asked for.
 */

import { useLayoutEffect, useRef } from 'preact/hooks';

import type { RunLog, RunSummary } from '../protocol';
import { formatBytes, formatElapsed } from './format';

/**
 * How close to the bottom still counts as "following": a `scrollTop` offset by
 * a sub-pixel layout rounding must not read as a deliberate scroll up. One line
 * of the log (`10px * 1.35`) is comfortably above the noise.
 */
const FOLLOW_SLACK_PX = 16;

export interface RunOutputProps {
  run: RunSummary | null;
  log: RunLog | null;
  onStop: (runId: string) => void;
}

/** The outcome, as a reader would say it. */
export function describeOutcome(run: RunSummary, log: RunLog | null): string {
  if (run.status === 'running') return 'running';
  if (run.signal) return `stopped (${run.signal})`;
  const code = log?.exitCode ?? run.exitCode;
  if (code === null) return run.status === 'failed' ? 'failed to start' : run.status;
  return `exit ${code}`;
}

export function RunOutput({ run, log, onStop }: RunOutputProps) {
  const preRef = useRef<HTMLPreElement>(null);
  /** True while the box is pinned to the tail; false once the reader scrolls up. */
  const followingRef = useRef(true);
  /** Run the box last followed, so a re-run starts following from scratch. */
  const followedRunRef = useRef<string | null>(null);

  const runId = run?.id ?? null;
  const text = log?.text ?? '';

  // Layout effect, not effect: `scrollHeight` is read after the rows are
  // committed and the jump lands before paint, so a streamed line never renders
  // one frame at its old position.
  useLayoutEffect(() => {
    const element = preRef.current;
    if (!element) return;
    if (followedRunRef.current !== runId) {
      followedRunRef.current = runId;
      followingRef.current = true;
    }
    if (!followingRef.current) return;
    // Assigning past the maximum is clamped to the exact tail by the browser.
    element.scrollTop = element.scrollHeight;
  }, [runId, text]);

  // Unreachable through the row (its disclosure is disabled without a run), and
  // still honest if a caller renders it directly.
  if (!run) {
    return <p className="px-3 pb-2 pt-1 text-[11px] text-ink/40">Not run yet.</p>;
  }

  const bytes = log?.bytes ?? run.bytes;
  const ringBytes = log?.ringBytes ?? run.ringBytes;
  const truncated = log?.truncated ?? run.bytes > run.ringBytes;

  return (
    <div className="px-3 pb-2 pt-0.5">
      <div className="flex items-center gap-2 text-[9px] font-mono text-ink/45">
        <span>{describeOutcome(run, log)}</span>
        {run.status === 'running' ? (
          <span>{formatElapsed(Date.now() - run.startedAt)}</span>
        ) : run.endedAt ? (
          <span>{formatElapsed(run.endedAt - run.startedAt)}</span>
        ) : null}
        {truncated ? (
          <span className="ml-auto" title={`The buffer holds the last ${formatBytes(ringBytes)}`}>
            last {formatBytes(Math.min(bytes, ringBytes))} of {formatBytes(bytes)}
          </span>
        ) : (
          <span className="ml-auto">{formatBytes(bytes)}</span>
        )}
        {run.status === 'running' ? (
          <button
            type="button"
            onClick={() => onStop(run.id)}
            title={`Stop ${run.label}`}
            className="px-1.5 rounded border border-error/40 text-error hover:bg-error/10 transition-colors cursor-pointer"
          >
            Stop
          </button>
        ) : null}
      </div>

      {/* The Kabmo's code-block shell, inline: `tailwind.css` styles
          `.prose-content .code-block`, which a plugin's DOM is not inside, so the
          same tokens are written here. A plugin cannot import the host's
          stylesheet — it renders in the host's document with the host's utilities,
          which is what these classes are.

          `text-[10px]`, one step BELOW the command label's `text-[11px]`: the log
          is the command's OUTPUT, not the thing being chosen, so it must not
          out-weigh the row that names it. (It was `text-xs` — 12px, a full step
          larger than the label it belongs to, which put the reader's eye on the
          output of a command rather than on the command.) The line box is a ratio
          of the size (`leading-[1.35]`) so a wrapped log line stays readable at
          any zoom the editor's font control applies. */}
      <pre
        ref={preRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followingRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_SLACK_PX;
        }}
        className="mt-1 mb-0 rounded-lg border border-ink/15 bg-canvas font-mono text-[10px] leading-[1.35] whitespace-pre-wrap break-all px-3 py-2 max-h-72 overflow-y-auto scrollbar-overlay-container"
      >
        {text || (run.status === 'running' ? '(running, no output yet)' : '(no output)')}
      </pre>
    </div>
  );
}
