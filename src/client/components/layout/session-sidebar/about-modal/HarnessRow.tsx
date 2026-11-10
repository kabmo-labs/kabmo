/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ONE harness line in the About card: state, version, and the one action that
 * harness can do — plus whatever its own update record says.
 *
 * Split out of `HarnessTable` when per-harness update records arrived: the row
 * now reads three things (the catalog entry, the version row, and ITS OWN
 * update record), and keeping that next to the section's tally and heading
 * pushed the file past the 350-line ceiling. The section owns the list; this owns
 * one line of it.
 *
 * Everything a row states, and why, is in `HarnessTable.tsx`'s header: this file
 * is that row's markup and its three-column grid.
 */

import { Download, Loader2 } from 'lucide-preact';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { UpdateLogLine } from '@/client/components/layout/session-sidebar/about-modal/UpdateLogLine';
import { jobQueued, jobRunning, runningStepOf } from '@/shared/lib/harness/update-job';
import { harnessStatus, type HarnessState } from '@/shared/lib/harness/status';
import type { HarnessSummary } from '@/shared/types/harness';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';
import type { HarnessVersionRow } from '@/shared/types/harness-version';

export interface HarnessRowProps {
  entry: HarnessSummary;
  version: HarnessVersionRow | null;
  /** This harness's own update record — installing, waiting, or settled. */
  job: HarnessUpdateJob | null;
  /** A refusal from a press on THIS row, or null. */
  problem: string | null;
  onOpenHarness: () => void;
  /** Starts this harness's update. */
  onUpdate: () => void;
  onOpenLog?: () => void;
}

/** The state mark. Shape carries the state, so tone is reinforcement only. */
function StateMark({ state }: { state: HarnessState }) {
  if (state === 'ready') return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-success" />;
  if (state === 'not-installed') return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full border border-ink/35" />;
  if (state === 'needs-setup') return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink/45" />;
  return <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ink/15" />;
}

/**
 * The three-column grid every data row uses.
 *
 * The widths are the point, and every earlier guess was wrong:
 *
 *  - the ACTION column held `7rem` for a single icon, stealing space from the
 *    version cell — so `0.100.0 → 0.101.0` truncated while the action cell sat
 *    mostly empty. It is `1.75rem` now: one 24px button and nothing else.
 *  - the VERSION column held `7.5rem` (120px), which clipped the widest thing
 *    it ever holds — an adapter's `adapter 0.100.0 → 0.101.0` line, measured at
 *    151px in this face. It is `9.5rem` (152px), the content's own width.
 *  - on a PHONE it is `7rem`: the About card is 512px at most, and the 152px
 *    track left the agent's own name ~130px, so `command-code` and
 *    `deepseek-harness` were the cells that truncated while the name is the one
 *    thing a reader is scanning for. The version line ellipsizes instead, and
 *    carries its full text in `title`.
 *
 * It stays a FIXED track rather than `auto`: every row is its own grid, so an
 * `auto` track is measured per row and the version numbers stop lining up in a
 * column (measured: a name cell of 352px on one row and 208px on the next).
 *
 * The name takes the slack and ellipsizes. The card's own width is FIXED
 * (`md:w-[880px]`), so the name track cannot collapse the dialog — that only
 * happened while the card was `w-auto`.
 *
 * `items-start`, not `items-center`: each cell holds two lines whose heights
 * differ from row to row (a version cell is 16px alone and 31px with an
 * `adapter …` line under it), and centering measured the number 7.5px BELOW the
 * name it belongs to. Top-aligned, line one of every cell shares one baseline.
 */
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_7rem_1.75rem] items-start gap-x-2 md:grid-cols-[minmax(0,1fr)_9.5rem_1.75rem]';

export function HarnessRow({
  entry, version, job, problem, onOpenHarness, onUpdate, onOpenLog,
}: HarnessRowProps) {
  const status = harnessStatus(entry);
  // Three states, three answers: a worker is installing this one, this one is
  // WAITING for the install ahead of it, or nothing is running and the record is
  // the run that settled.
  const isUpdating = jobRunning(job);
  const isQueued = jobQueued(job);
  const busy = isUpdating || isQueued;
  const progress = isUpdating ? runningStepOf(job) : null;
  // The row that owns the record gets the log line: while it waits or installs,
  // and after it settles so the output is not lost with it.
  const showLogLine = busy || job?.finishedAt != null;
  // The number a reader calls "the version": the CLI when the harness is an
  // adapter, otherwise the agent itself. Each part carries its own `latest` and
  // its own ability to move, so the two are never compared across each other.
  //
  // A CLI part EXISTS for every adapter even when its `--version` could not be
  // read (the binary is absent, or its launcher is broken). Taking that empty
  // part as the lead painted `—` over a known adapter number: measured on
  // `zcode` (adapter 0.82.3 probed, no `zcode` runtime) and `claude`
  // (`claude --version` fails while the adapter answers). The part that HAS a
  // number leads.
  const cli = version?.cli ?? null;
  const agent = version?.agent ?? null;
  const lead = cli?.version ? cli : agent;
  const showAdapterLine = Boolean(
    cli?.version && agent?.version && agent.version !== cli.version,
  );
  // What the press would install, named: an adapter and a CLI are two different
  // products, so the accessible name says which is moving.
  const targets = version
    ? [
        version.agent.updateAvailable && version.agent.latest
          ? version.cli ? `adapter ${version.agent.latest}` : version.agent.latest
          : null,
        version.cli?.updateAvailable && version.cli.latest
          ? `${version.cli.name} ${version.cli.latest}`
          : null,
      ].filter((target): target is string => Boolean(target))
    : [];
  const updateLabel = `Update ${entry.label}${targets.length > 0 ? ` to ${targets.join(' + ')}` : ''}`;
  // While the background worker runs, the button names the STEP it is on: one
  // press can be an adapter install and then `claude update`, and "Updating…"
  // alone would hide which half is moving. A run that is WAITING says so — it
  // started when it was accepted, it installs when the queue reaches it.
  const actionLabel = isQueued
    ? `Queued: ${entry.label} update starts after the install that is running`
    : isUpdating && progress ? `Updating ${entry.label}: ${progress}` : updateLabel;

  return (
                <div className={`${COLUMNS} border-b border-ink/5 py-1.5`}>
                  {/* The name is the link: one target per row, and the row's other
                      cells stay selectable text.
                      TWO lines per cell, and the same two line boxes on both
                      sides: the name and its version share row one (16px), the
                      state label and the adapter line share row two (15px). Every
                      cell is a flex COLUMN of those two rows, which is what makes
                      `ready` sit exactly under `2.1.318` and beside
                      `adapter 0.100.0 →` (measured 8px apart when the cells were
                      centered independently). */}
                  <button
                    type="button"
                    onClick={onOpenHarness}
                    title={status.detail ?? undefined}
                    aria-label={`${entry.label} — ${status.label}. Open its settings.`}
                    className="flex min-w-0 cursor-pointer items-start gap-1.5 text-left"
                  >
                    {/* The glyph rides the FIRST row, not the middle of the pair:
                        centered on both rows it landed between the name and the
                        state label. */}
                    <span className="flex h-4 shrink-0 items-center">
                      <HarnessGlyph harness={entry.id} size={HARNESS_GLYPH_SIZE.compact} />
                    </span>
                    {/* The state mark sits in the label's TOP-RIGHT CORNER, not in
                        the flow: as a trailing child it took a column of its own and
                        every agent name lost ~14px to a 6px dot. Positioned, the
                        label keeps its width and the mark still reads as a status
                        light on that name. */}
                    <span className="flex min-w-0 flex-1 flex-col">
                      {/* The mark sits at the top-right of the NAME ITSELF, so the
                          wrapper must HUG the text — a `flex-1` wrapper anchored the
                          dot to the column's edge instead, which read as a marker on
                          the version beside it. `max-w-full` keeps it on the name and
                          still allows the truncation. */}
                      <span className="flex max-w-full items-center gap-1.5">
                        <span className={`truncate text-[11px] leading-4 ${status.state === 'ready' ? 'font-medium text-ink' : 'text-ink/70'}`}>
                          {entry.label}
                        </span>
                        <StateMark state={status.state} />
                      </span>
                      <span className="block truncate text-[10px] leading-[15px] text-ink/40">{status.label}</span>
                    </span>
                  </button>

                  {/* TWO number lines, each with its OWN arrow.
                      A harness can be an adapter over a CLI, and the two move
                      independently: the row leads with the CLI's `2.1.318` and states
                      `adapter 0.101.0` underneath, so `→` may only ever join the two
                      numbers on ITS line. Joining `2.1.318` with the adapter's latest
                      would compare two different products — the fiction this cell
                      exists to prevent. */}
                  <span
                    className="flex min-w-0 flex-col items-end text-right font-mono text-[11px] leading-4 text-ink/70"
                    title={version?.note ?? undefined}
                  >
                    <span className="block max-w-full truncate">
                      {/* The CLI's version leads when the harness is an ADAPTER: it
                          is the number a user recognises (`claude --version` →
                          2.1.318). */}
                      {lead?.version ?? <span className="text-ink/30">—</span>}
                      {lead?.updateAvailable && lead.latest && (
                        <>
                          <span aria-hidden="true" className="ml-1 text-ink/35">→</span>
                          <span className="ml-1 text-ink">{lead.latest}</span>
                        </>
                      )}
                    </span>
                    {/* The adapter's own number and its own move. It lives INSIDE
                        the version cell — as a fourth grid child it shifted every
                        row one track and moved the action button onto its own line. */}
                    {showAdapterLine && version && (
                      <span
                        className="block max-w-full truncate text-[10px] leading-[15px] text-ink/35"
                        title={`${version.cli?.name ?? 'CLI'} ${version.cli?.version ?? 'unknown'} · adapter ${version.agent.version}`}
                      >
                        adapter {version.agent.version}
                        {version.agent.updateAvailable && version.agent.latest
                          ? ` → ${version.agent.latest}`
                          : ''}
                      </span>
                    )}
                  </span>

                  <div className="flex min-w-0 justify-end">
                    {/* ICON ONLY, and only when there is something to move to.
                        A row with no newer version shows nothing: a permanent action
                        button claims work that does not exist. The label lives in
                        `title` + `aria-label`, so the meaning is not lost — it is just
                        not spent on every row. The icon is a DOWNLOAD arrow because
                        that is what the press does; it used to be `ArrowUpRight`, which
                        reads as "open this elsewhere". */}
                    {version?.updateAvailable ? (
                      <button
                        type="button"
                        onClick={onUpdate}
                        // Disabled for BOTH halves: a second press for a harness
                        // that is already waiting would only be refused, and the
                        // button's own state is the answer.
                        disabled={busy}
                        aria-label={actionLabel}
                        title={actionLabel}
                        className="inline-flex cursor-pointer items-center justify-center rounded border border-ink/25 p-1 text-ink transition-colors hover:border-ink/50 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy
                          ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />
                          : <Download size={11} />}
                      </button>
                    ) : (
                      <span className="text-[10px] text-ink/25">—</span>
                    )}
                  </div>

                  {problem && (
                    <span className="col-span-3 pb-1 text-[10px] text-ink/70">{problem}</span>
                  )}

                  {showLogLine && (
                    <UpdateLogLine
                      running={isUpdating}
                      queued={isQueued}
                      progress={progress}
                      message={job?.message ?? null}
                      onOpenLog={onOpenLog}
                    />
                  )}
                </div>
              );
}
