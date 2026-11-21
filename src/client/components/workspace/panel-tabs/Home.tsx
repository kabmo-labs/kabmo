/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A browser-style column's home page: the catalog as a grid of cards.
 *
 * This is what the column shows when nothing is open, and what the add control
 * opens. It is the CATALOG, not the working set: every view the column could
 * draw is a card, and a view that is already open is a card that says so and
 * cannot be opened twice — which is the duplicate-tab rule stated where the user
 * is most likely to break it.
 *
 * The card is a button, not a link: there is no URL, and `aria-pressed` is the
 * honest state ("this view is already on a tab"). A card the user has already
 * opened stays pressable and focuses its tab, because the alternative — a
 * `disabled` button — cannot be focused, cannot explain itself and, measured in
 * Chromium on the harness tabs, never shows its `title` either.
 *
 * Density: two columns under 420px of panel, three above. A card's whole content
 * is its mark, its label and one line of description, so the grid reflows by
 * itself and there is no measured overflow rule to keep in step.
 */

import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import { PanelMark } from '@/client/components/common/panel-mark';
import { PANEL_MARK_SIZE } from '@/shared/lib/workspace/right-panels';

interface PanelHomeProps {
  /** The column's whole catalog, in its own order. */
  panels: readonly ResolvedPanel[];
  /** The ids currently on a tab, so a card can say "sudah terbuka". */
  openIds: ReadonlySet<string>;
  /** Open a view, or focus it when it is already open. */
  onPick: (id: string) => void;
  /** What the column is for, so the empty state is not generic copy. */
  title: string;
}

export function PanelHome({ panels, openIds, onPick, title }: PanelHomeProps) {
  return (
    <div className="@container flex h-full flex-col overflow-y-auto scrollbar-overlay-container px-3 py-4 select-none">
      {/* Centred in whatever room the column has, and it degrades correctly when
          there is none: `my-auto` on a flex child in a scroll container centres
          the block while it FITS and lets it start at the top the moment it does
          not, so a long catalog scrolls from the first card instead of clipping
          the heading above the viewport. `justify-center` would have done the
          clipping — the classic flex-overflow trap. */}
      <div className="mx-auto my-auto w-full max-w-[460px]">
        <h2 className="text-xs font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-[11px] leading-relaxed text-ink/50">
          Klik kartu untuk membukanya sebagai tab. Satu view hanya punya satu tab.
        </p>

        {/* TWO columns at this column's 200–268px floor and three only once the
            column is actually wide: a viewport breakpoint would draw three cards
            in a 268px right panel on a 1440px window, which is what the first
            render did. `@[...]` is the container's own width. */}
        <div className="mt-4 grid grid-cols-2 gap-2 @[380px]:grid-cols-3">
          {panels.map((panel) => {
            const opened = openIds.has(panel.id);
            return (
              <button
                key={panel.id}
                type="button"
                onClick={() => onPick(panel.id)}
                aria-pressed={opened}
                aria-label={
                  opened ? `${panel.title} — sudah terbuka, klik untuk fokus` : `Buka ${panel.title}`
                }
                title={panel.title}
                className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors ${
                  opened
                    ? 'border-ink/25 bg-ink/5'
                    : 'border-ink/15 bg-paper hover:border-ink/30 hover:bg-ink/5'
                }`}
              >
                <PanelMark
                  className="inline-flex"
                  panelId={panel.id}
                  builtin={panel.builtin}
                  icon={panel.builtin ? panel.icon : undefined}
                  name={panel.builtin ? panel.label : panel.name}
                  {...(panel.iconUrl ? { iconUrl: panel.iconUrl } : {})}
                  {...(panel.color ? { color: panel.color } : {})}
                  size={PANEL_MARK_SIZE + 4}
                />
                <span className="line-clamp-1 text-[11px] font-semibold text-ink">{panel.label}</span>
                {/* The second line earns its place or is dropped: `panel.title`
                    REPEATED `panel.label` on ten of the twelve views ("Search" over
                    "Search"), which read as a duplicated word. It is printed only
                    when it says something the label did not — otherwise the card
                    falls back to a fact about the view. The floor keeps a row of
                    cards level when one of them has nothing to add. */}
                <span className="line-clamp-2 min-h-[26px] text-[10px] leading-snug text-ink/50">
                  {opened
                    ? 'Sudah terbuka'
                    : panel.title !== panel.label
                      ? panel.title
                      : panel.requiresWorkspace
                        ? 'Butuh folder kerja'
                        : ''}
                </span>
              </button>
            );
          })}
        </div>

        {panels.length === 0 ? (
          <p className="mt-4 text-[11px] italic text-ink/40">
            Tidak ada view yang bisa dibuka di kolom ini.
          </p>
        ) : null}
      </div>
    </div>
  );
}
