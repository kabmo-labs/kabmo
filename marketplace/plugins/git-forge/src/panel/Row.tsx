/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One row in the list.
 *
 * A row is a BUTTON, because its only action is "open this" — and the whole row
 * is the target, not the title text. The state badge, the labels and the age sit
 * on the same line as the title because a forge list is read by scanning
 * (what is open, what is stale, what is labelled), and a three-line row triples
 * the height for the same information.
 *
 * The title truncates rather than wraps: a long title that wraps makes the rows
 * uneven, and the full title is the first thing the item's own page shows.
 *
 * The age is `tabular-nums` so a column of them lines up, and its tooltip is the
 * full timestamp: a compact `3d` is a scan aid, not the only copy of the date.
 */

import type { ForgeItem } from '../protocol';
import { LabelChips, StateBadge } from './Badge';
import { Glyph, ICON } from './Glyph';
import { STATE_LABEL, fullTime, itemIdLabel, relativeTime } from './format';

interface RowProps {
  item: ForgeItem;
  selected: boolean;
  onOpen: () => void;
}

export function ItemRow({ item, selected, onOpen }: RowProps) {
  const age = relativeTime(item.updatedAt);
  // The accessible name is stated rather than assembled: the row's text is five
  // separate spans (state, title, age, id, author, comments, labels), so a name
  // read off the DOM is one run-on string — measured as
  // `Open`--cpu-prof` pins every sampled callee…30m#42377jdalton7bugperf+1`.
  const accessibleName = `${STATE_LABEL[item.state]} ${itemIdLabel(item)}: ${item.title} by ${item.author}`;
  return (
    <button
      type="button"
      data-forge-row
      onClick={onOpen}
      title={`${itemIdLabel(item)} ${item.title}`}
      aria-label={accessibleName}
      aria-current={selected ? 'true' : undefined}
      className={`flex w-full cursor-pointer flex-col gap-1 border-b border-ink/8 px-2.5 py-2 text-left transition-colors focus-visible:outline-none ring-inset focus-visible:ring-2 focus-visible:ring-ink/20 ${
        selected ? 'bg-ink/8' : 'hover:bg-ink/5'
      }`}
    >
      <span aria-hidden="true" className="flex items-center gap-1.5">
        <StateBadge state={item.state} />
        <span className="min-w-0 flex-1 truncate text-xs text-ink">{item.title}</span>
        <span className="flex-shrink-0 font-mono text-[10px] tabular-nums text-ink/60" title={fullTime(item.updatedAt)}>
          {age}
        </span>
      </span>
      <span aria-hidden="true" className="flex items-center gap-1.5 text-[10px] text-ink/60">
        <span className="flex-shrink-0 font-mono">{itemIdLabel(item)}</span>
        <span className="min-w-0 truncate">{item.author}</span>
        {item.comments > 0 && (
          <span className="flex flex-shrink-0 items-center gap-0.5" title={`${item.comments} comments`}>
            <Glyph path={ICON.comment} size={10} />
            {item.comments}
          </span>
        )}
        <span className="ml-auto flex-shrink-0">
          <LabelChips labels={item.labels} />
        </span>
      </span>
    </button>
  );
}
