/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's search line.
 *
 * A FIELD, not a mode: the classic toolbar spends a 28px button on toggling a
 * search box that then pushes the list down, which costs a click before the
 * user can type and moves every row when it opens. Here the field is always
 * there, at the top, and the list never shifts — so search is something you do,
 * not something you enter.
 *
 * The icon, the input and the clear control are FLEX SIBLINGS inside the field
 * box rather than three absolutely-positioned layers. The earlier version
 * centred the glyph against the wrapper — which includes the field's own bottom
 * margin — so the icon sat 4px below the placeholder's optical centre, and its
 * `left`/`pl` pair had to be kept in sync by hand. As siblings they share one
 * baseline and one vertical centre by construction.
 *
 * The clear control appears only while there is a query, and `aria-label` names
 * it: an icon-only button with no name is unreachable to a screen reader and
 * to `getByRole`, which is why every control in this app carries one.
 */

import { Search, X } from 'lucide-preact';

interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Larger target and text for a touch row. */
  touch?: boolean;
}

export function SearchField({ value, onChange, touch = false }: SearchFieldProps) {
  return (
    // `pt-2`/`pt-3` keeps the field off the column's own top edge: flush against
    // it the rounded corner read as the panel's corner, not as a control.
    <div className={touch ? 'px-3 pt-3 pb-2' : 'px-3 pt-2 pb-2'}>
      <div
        className={`flex items-center gap-1.5 rounded-lg border border-ink/10 bg-ink/[0.04] px-2 transition-colors focus-within:border-ink/30 focus-within:bg-paper ${
          touch ? 'h-9' : 'h-7'
        }`}
      >
        <Search
          size={touch ? 15 : 13}
          aria-hidden="true"
          className="shrink-0 text-ink/35"
        />
        <input
          type="search"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Search workspaces & sessions"
          aria-label="Search workspaces and sessions"
          className={`min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink/40 ${
            touch ? 'text-[13px]' : 'text-xs'
          }`}
        />
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            title="Clear search"
            aria-label="Clear search"
            className="-mr-0.5 shrink-0 rounded p-0.5 text-ink/40 transition-colors cursor-pointer hover:bg-ink/10 hover:text-ink"
          >
            <X size={touch ? 14 : 12} />
          </button>
        )}
      </div>
    </div>
  );
}
