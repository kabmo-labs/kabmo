/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A row's badges: the state, and the host's labels.
 *
 * Both are monochrome by default and coloured only where the host supplied a
 * colour of its own. GitHub sends six hex digits per label and GitLab sends
 * plain names; a label with no colour must still be legible, so it falls back to
 * the theme's own ink rather than to a generated shade — a hash-derived colour
 * is a colour the author never chose.
 *
 * The label's own colour is used for the TEXT and a 12% tint for its plate, the
 * same treatment the theme applies to a semantic token, because a label's colour
 * is authored against white and a solid fill would be unreadable in a dark
 * palette.
 */

import type { ForgeItemState, ForgeLabel } from '../protocol';
import { STATE_LABEL, STATE_TONE } from './format';

export function StateBadge({ state }: { state: ForgeItemState }) {
  return (
    <span
      className={`flex-shrink-0 text-[10px] font-medium uppercase tracking-wide ${STATE_TONE[state]}`}
      title={STATE_LABEL[state]}
    >
      {STATE_LABEL[state]}
    </span>
  );
}

/** One label chip. */
function LabelChip({ label }: { label: ForgeLabel }) {
  if (!label.color) {
    return (
      <span className="rounded border border-ink/15 px-1 py-px text-[9.5px] leading-tight text-ink/60">
        {label.name}
      </span>
    );
  }
  return (
    <span
      className="rounded px-1 py-px text-[9.5px] leading-tight"
      style={{ color: `#${label.color}`, backgroundColor: `#${label.color}1f` }}
    >
      {label.name}
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
        <span className="text-[9.5px] text-ink/40" title={labels.map((label) => label.name).join(', ')}>
          +{rest}
        </span>
      )}
    </span>
  );
}
