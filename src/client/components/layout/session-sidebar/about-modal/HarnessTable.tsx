/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Agents table: ONE row per harness, carrying everything About knows about it
 * and nothing twice.
 *
 * The card used to draw the same fourteen agents in two places — a status grid
 * and, below it, a versions table — which is why it grew to 980px tall. A reader
 * scanning for "is this working, and is it current?" was reading the same names
 * twice to answer two halves of one question. The row answers both, and the card
 * is roughly half its height.
 *
 * What each row states, and why:
 *
 *  - **state** — `ready` / `needs setup` / `not installed` / `not probed`, from
 *    `harnessStatus`. Carried by a SHAPE, not only a tone.
 *  - **version** — what the agent reported. A dash when it has never answered,
 *    with the reason in the title, because a number here would be invented.
 *  - **one action**, chosen by what the harness can do: `Update` (npm), the
 *    vendor's own command (self / vendor-managed), or nothing but a link to its
 *    settings page.
 *
 * A row is a LINK first: clicking it opens that harness's settings page. Editing
 * lives there; About is where you learn which page to open and whether anything
 * needs doing first.
 *
 * The mark*up* of one row lives in `HarnessRow.tsx`; this file owns the heading,
 * the tally, and the list. It also owns the one handler a press goes through, so
 * a refusal is shown under the row it belongs to and never under a neighbour.
 */

import { useState } from 'preact/hooks';
import { HarnessRow } from '@/client/components/layout/session-sidebar/about-modal/HarnessRow';
import { harnessStatus } from '@/shared/lib/harness/status';
import { harnessCategoryId } from '@/shared/lib/harness/menu';
import type { HarnessSummary } from '@/shared/types/harness';
import type { HarnessUpdateJob } from '@/shared/types/harness-update';
import type { HarnessVersionRow } from '@/shared/types/harness-version';

interface HarnessTableProps {
  harnesses: HarnessSummary[];
  versions: HarnessVersionRow[];
  loading?: boolean;
  onOpenHarness: (id: string) => void;
  /** Starts one harness's update as a background job and follows it; resolves
   *  to a refusal (a busy server, an unknown harness), or null when it began —
   *  immediately, or queued behind the install already running. */
  onUpdate: (id: string) => Promise<string | null>;
  /**
   * The last known update record PER HARNESS: waiting its turn, installing, or
   * the run that settled.
   *
   * Per harness, not one: two presses are two records, and a row may only ever
   * show its own run (`jobQueued`, `jobRunning`, `runningStepOf`).
   */
  jobs?: HarnessUpdateJob[];
  /**
   * Opens the log of ONE harness's record. It takes the id because there can be
   * a waiting run and an installing one at the same time; the row names its own.
   */
  onOpenLog?: (harness: string) => void;
  /** Drops one harness's settled record; resolves to a refusal, or null. */
  onDismiss?: (harness: string) => Promise<string | null>;
}

export function HarnessTable({
  harnesses, versions, loading = false, onOpenHarness, onUpdate, jobs = [],
  onOpenLog, onDismiss,
}: HarnessTableProps) {
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);

  const byId = new Map(versions.map((row) => [row.id, row]));
  // ONE record per harness: the row renders its own run, never a neighbour's.
  const jobById = new Map(jobs.map((job) => [job.harness, job]));
  // The built-in transport is the default every discovered session runs on, with
  // nothing to install, probe or update; listing it would inflate the count with
  // the one entry nobody has to decide about.
  const entries = harnesses.filter((entry) => !entry.builtIn);
  const ready = entries.filter((entry) => harnessStatus(entry).state === 'ready').length;
  const updatable = entries.filter((entry) => byId.get(entry.id)?.updateAvailable).length;

  const runUpdate = async (id: string) => {
    const message = await onUpdate(id);
    setProblem(message ? { id, message } : null);
  };

  // A refusal from a dismissal is shown under the same row, for the same reason
  // a refused press is: the reader pressed something on THAT line.
  const runDismiss = async (id: string) => {
    if (!onDismiss) return;
    const message = await onDismiss(id);
    setProblem(message ? { id, message } : null);
  };

  return (
    <section className="text-left" aria-labelledby="agents-heading">
      <div className="mb-1.5 flex items-baseline justify-between gap-2 border-b border-ink/10 pb-1.5">
        <h3 id="agents-heading" className="text-[10px] font-semibold uppercase tracking-wider text-ink/45">
          Agents
        </h3>
        {/* The tally and the exit sit on the heading's row, at the right edge,
            instead of under a 200px table: both are ABOUT this section rather
            than a continuation of it. */}
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-ink/40">
            {loading ? 'reading…' : `${ready}/${entries.length} ready`}
            {updatable > 0 ? ` · ${updatable} update${updatable === 1 ? '' : 's'}` : ''}
          </span>
          <button
            type="button"
            onClick={() => onOpenHarness('')}
            className="cursor-pointer text-[10px] text-ink/45 transition-colors hover:text-ink"
          >
            Open Settings → Harnesses
          </button>
        </div>
      </div>

      {/* No column header: the three cells are self-describing (a glyph + name,
          a version line, one icon) and the labels cost a line of height while
          their widths fought the cells they described. The heading row above
          already names the section. */}

      {loading && entries.length === 0 ? (
        <div className="space-y-1 py-1">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-7 animate-pulse rounded bg-ink/[0.05]" />
          ))}
        </div>
      ) : (
        // ONE list, no scroll cap of its own. It used to be `max-h-[46vh]
        // overflow-y-auto` on a phone, which scroll-trapped fourteen rows inside
        // a card that had most of the screen empty below them — two nested
        // scrollers, and the inner one had no reason to exist. The About panel's
        // own body is the single scroller now, so the list simply grows.
        <div data-harness-rows="" className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          {entries.map((entry) => (
            <HarnessRow
              key={entry.id}
              entry={entry}
              version={byId.get(entry.id) ?? null}
              job={jobById.get(entry.id) ?? null}
              problem={problem?.id === entry.id ? problem.message : null}
              onOpenHarness={() => onOpenHarness(entry.id)}
              onUpdate={() => void runUpdate(entry.id)}
              onOpenLog={onOpenLog ? () => onOpenLog(entry.id) : undefined}
              onDismiss={onDismiss ? () => void runDismiss(entry.id) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** The category a harness row opens. `''` means the overview page. */
export function harnessCategoryFor(id: string): string {
  return id ? harnessCategoryId(id) : 'harness-index';
}
