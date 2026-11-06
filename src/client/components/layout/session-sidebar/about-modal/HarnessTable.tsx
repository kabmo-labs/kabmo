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
 */

import { useState } from 'preact/hooks';
import { ArrowUpRight, Loader2 } from 'lucide-preact';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { harnessStatus, type HarnessState } from '@/shared/lib/harness/status';
import { harnessCategoryId } from '@/shared/lib/harness/menu';
import type { HarnessSummary } from '@/shared/types/harness';
import type { HarnessVersionRow } from '@/client/hooks/models/use-harness-versions';

interface HarnessTableProps {
  harnesses: HarnessSummary[];
  versions: HarnessVersionRow[];
  loading?: boolean;
  onOpenHarness: (id: string) => void;
  /** Runs one npm harness's update; resolves to a refusal, or null. */
  onUpdate: (id: string) => Promise<string | null>;
  /** Which harness is mid-update. */
  updating: string | null;
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
const COLUMNS = 'grid grid-cols-[minmax(0,1fr)_9.5rem_1.75rem] items-start gap-x-2';

export function HarnessTable({
  harnesses, versions, loading = false, onOpenHarness, onUpdate, updating,
}: HarnessTableProps) {
  const [problem, setProblem] = useState<{ id: string; message: string } | null>(null);

  const byId = new Map(versions.map((row) => [row.id, row]));
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
        // On a PHONE the list scrolls inside the card; on a desktop the card grows
        // to fit it, because a dialog that scrolls fourteen rows is hiding
        // information it has the room to show.
        <div className="grid max-h-[46vh] grid-cols-1 gap-x-6 overflow-y-auto scrollbar-overlay-container md:max-h-none md:grid-cols-2 md:overflow-visible">
          {entries.map((entry) => {
            const status = harnessStatus(entry);
            const version = byId.get(entry.id);
            const isUpdating = updating === entry.id;
            return (
              <div key={entry.id} className={`${COLUMNS} border-b border-ink/5 py-1.5`}>
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
                  onClick={() => onOpenHarness(entry.id)}
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

                {/* The INSTALLED version is the fact; the arrow is the claim that
                    there is somewhere to move. `0.100.0 → 0.101.0` reads as ONE
                    statement on the number's own line, and a row with no newer
                    version stays a single number — no arrow, nothing to act on.
                    The pair sits on one line for a reason: as separate flex
                    children the arrow and the newer number each took a row. */}
                <span
                  className="flex min-w-0 flex-col items-end text-right font-mono text-[11px] leading-4 text-ink/70"
                  title={version?.updateAvailable
                    ? `${version.current ?? 'unknown'} → ${version.latest ?? 'unknown'}`
                    : version?.note ?? undefined}
                >
                  <span className="block max-w-full truncate">
                    {/* The CLI's version leads when the harness is an ADAPTER: it
                        is the number a user recognises (`claude --version` →
                        2.1.318), and the adapter's own 0.100.x is the smaller line
                        under it. */}
                    {version?.cli?.version ?? version?.current ?? <span className="text-ink/30">—</span>}
                    {/* The arrow may only point between the SAME number line. When
                        the row leads with the CLI's version, the package in `latest`
                        belongs to the ADAPTER — `2.1.318 → 0.101.0` would be a
                        fabricated comparison. The adapter's own move is stated on
                        its own line instead. */}
                    {version?.updateAvailable && version.latest && !version.cli?.version && (
                      <>
                        <span aria-hidden="true" className="ml-1 text-ink/35">→</span>
                        <span className="ml-1 text-ink">{version.latest}</span>
                      </>
                    )}
                  </span>
                  {/* The adapter's own number, when it differs from the CLI's:
                      two real versions for two real things. It lives INSIDE the
                      version cell — as a fourth grid child it shifted every row
                      one track and moved the action button onto its own line. */}
                  {version?.cli?.version && version.agentVersion && version.agentVersion !== version.cli.version && (
                    <span
                      className="block max-w-full truncate text-[10px] leading-[15px] text-ink/35"
                      title={`${version.cli.name} ${version.cli.version} · adapter ${version.agentVersion}`}
                    >
                      adapter {version.agentVersion}
                      {version.updateAvailable && version.latest ? ` → ${version.latest}` : ''}
                    </span>
                  )}
                </span>

                <div className="flex min-w-0 justify-end">
                  {/* ICON ONLY, and only when there is something to move to.
                      A row with no newer version shows nothing: a permanent action
                      button claims work that does not exist, and a copy chip for
                      every vendor command turned the column into prose. The label
                      lives in `title` + `aria-label`, so the meaning is not lost —
                      it is just not spent on every row. */}
                  {version?.updateAvailable ? (
                    <button
                      type="button"
                      onClick={() => void runUpdate(entry.id)}
                      disabled={isUpdating}
                      aria-label={`Update ${entry.label}${version.latest ? ` to ${version.latest}` : ''}`}
                      title={`Update ${entry.label}${version.latest ? ` → ${version.latest}` : ''}`}
                      className="inline-flex cursor-pointer items-center justify-center rounded border border-ink/25 p-1 text-ink transition-colors hover:border-ink/50 hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isUpdating
                        ? <Loader2 size={11} className="animate-spin motion-reduce:animate-none" />
                        : <ArrowUpRight size={11} />}
                    </button>
                  ) : (
                    <span className="text-[10px] text-ink/25">—</span>
                  )}
                </div>

                {problem?.id === entry.id && (
                  <span className="col-span-3 pb-1 text-[10px] text-ink/70">{problem.message}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

    </section>
  );
}

/** The category a harness row opens. `''` means the overview page. */
export function harnessCategoryFor(id: string): string {
  return id ? harnessCategoryId(id) : 'harness-index';
}
