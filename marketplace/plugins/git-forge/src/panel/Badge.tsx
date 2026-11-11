/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A row's badges: the state, and the host's labels.
 *
 * **The state is a shape AND a word.** A colour alone is the one thing a
 * colour-blind reader cannot use, and the word alone is slow to scan down a
 * column, so the badge carries both: a glyph whose silhouette differs per state
 * (circle, ticked circle, merge arrow, dashed circle, tag) and the state's own
 * name.
 *
 * **A label's colour is a DOT, not its text.** GitHub sends six hex digits per
 * label and GitLab sends plain names; the colour is authored against white, so
 * painting the name in it makes the chip unreadable on every dark palette. The
 * dot carries the host's colour and the name stays in the theme's ink, which is
 * the only combination that is legible in all 63 palettes.
 */

import type { ForgeItemState, ForgeLabel } from '../protocol';
import { Glyph, ICON } from './Glyph';
import { STATE_LABEL, STATE_TONE } from './format';

/** The silhouette that makes each state distinguishable without colour. */
const STATE_GLYPH: Record<ForgeItemState, string> = {
  open: ICON.circle,
  closed: ICON.issueClosed,
  merged: ICON.merge,
  draft: ICON.draft,
  published: ICON.release,
  prerelease: ICON.release,
};

export function StateBadge({ state }: { state: ForgeItemState }) {
  return (
    <span
      className={`flex flex-shrink-0 items-center gap-1 text-[10px] font-medium uppercase tracking-wide ${STATE_TONE[state]}`}
      title={STATE_LABEL[state]}
    >
      <Glyph path={STATE_GLYPH[state]} size={10} />
      {STATE_LABEL[state]}
    </span>
  );
}

/** One label chip: the host's colour as a dot, the name in the theme's ink. */
function LabelChip({ label }: { label: ForgeLabel }) {
  return (
    <span
      className="flex max-w-[9rem] items-center gap-1 rounded border border-ink/15 px-1 py-px text-[10px] leading-tight text-ink/70"
      title={label.name}
    >
      {label.color && (
        <span
          aria-hidden="true"
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: `#${label.color}` }}
        />
      )}
      <span className="truncate">{label.name}</span>
    </span>
  );
}

/**
 * The labels a row shows, with a `+n` for the rest.
 *
 * Capped because a row is one line: a PR with nine labels would push the title
 * out of the panel, and the full list is on the item's own page anyway.
 */
export function LabelChips({ labels, max = 2 }: { labels: readonly ForgeLabel[]; max?: number }) {
  if (labels.length === 0) return null;
  const shown = labels.slice(0, max);
  const rest = labels.length - shown.length;
  return (
    <span className="flex flex-shrink-0 items-center gap-1">
      {shown.map((label) => (
        <LabelChip key={label.name} label={label} />
      ))}
      {rest > 0 && (
        <span className="text-[10px] text-ink/60" title={labels.map((label) => label.name).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  );
}
