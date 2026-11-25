/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The rows of a `SearchSelect`, with the states every picker needs and most
 * hand-rolled ones forget:
 *
 * - **the empty choice** ("the agent decides") stays the first row, whatever
 *   the filter says — it is a value, not an absence;
 * - **a stored value the list no longer holds** stays visible as `(not listed)`
 *   so it can be cleared instead of being silently replaced by the first row;
 * - **no options at all** says so (`emptyText`), and **no match** names the
 *   query, so an empty panel never looks like a broken control;
 * - **group headings** keep the caller's order.
 *
 * Split out of `index.tsx` so the control stays under the file ceiling; it is
 * presentational and takes the flat index the arrow keys walk.
 */

import type { ComponentChildren } from 'preact';
import type { MutableRefObject } from 'preact/compat';
import { Check } from 'lucide-preact';
import type { SearchSelectOption } from '@/client/components/common/search-select/option';

export interface OptionGroup {
  name: string;
  rows: SearchSelectOption[];
}

export interface OptionListProps {
  listboxId: string;
  ariaLabel: string;
  value: string;
  /** The empty value's row label; drawn only when `allowEmpty`. */
  placeholder: string;
  allowEmpty: boolean;
  /** The value is in `options`, so no `(not listed)` row is needed. */
  hasSelected: boolean;
  filtered: readonly SearchSelectOption[];
  groups: readonly OptionGroup[];
  query: string;
  emptyText: string;
  activeIndex: number;
  /** `MutableRefObject` because the rows WRITE their own slot into it. */
  optionRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  icon?: (option: SearchSelectOption) => ComponentChildren;
  onCommit: (value: string) => void;
  onHover: (index: number) => void;
}

export function OptionList({
  listboxId,
  ariaLabel,
  value,
  placeholder,
  allowEmpty,
  hasSelected,
  filtered,
  groups,
  query,
  emptyText,
  activeIndex,
  optionRefs,
  icon,
  onCommit,
  onHover,
}: OptionListProps) {
  // The empty row takes slot 0 of `optionRefs`; without it the flat rows start
  // there. One offset, computed once, so the ref and the arrow key agree.
  const offset = allowEmpty ? 1 : 0;

  return (
    <div id={listboxId} role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto py-1">
      {allowEmpty && (
        <button
          type="button"
          role="option"
          aria-selected={value === ''}
          ref={(node) => {
            optionRefs.current[0] = node;
          }}
          onClick={() => onCommit('')}
          onMouseEnter={() => onHover(0)}
          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${
            value === '' ? 'text-ink' : 'text-ink/60'
          } hover:bg-ink/5`}
        >
          <span className="truncate italic">{placeholder}</span>
          {value === '' && <Check size={11} className="flex-shrink-0" />}
        </button>
      )}

      {value !== '' && !hasSelected && (
        <button
          type="button"
          role="option"
          aria-selected
          onClick={() => onCommit(value)}
          // Deliberately NOT in the arrow-key order: it is not a member of
          // `filtered`, so giving it a slot would make two rows share one index
          // and scroll the wrong one into view.
          className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-ink"
        >
          <span className="truncate">{value} (not listed)</span>
          <Check size={11} className="flex-shrink-0" />
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="px-3 py-2 italic text-ink/40">
          {query.trim() ? `No match for “${query.trim()}”` : emptyText}
        </div>
      ) : (
        groups.map((group) => (
          <div key={group.name || '__flat'}>
            {group.name && (
              <div className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-wider text-ink/35">
                {group.name}
              </div>
            )}
            {group.rows.map((option) => {
              // The FLAT index is what the arrow keys walk, so the ref is taken
              // from there and not from the group's own row.
              const flatIndex = filtered.indexOf(option);
              const isSelected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={option.disabled || undefined}
                  disabled={option.disabled}
                  ref={(node) => {
                    optionRefs.current[flatIndex + offset] = node;
                  }}
                  onClick={() => onCommit(option.value)}
                  onMouseEnter={() => onHover(flatIndex)}
                  title={option.hint ?? option.value}
                  className={`flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    flatIndex === activeIndex ? 'bg-ink/5' : ''
                  } ${isSelected ? 'font-medium text-ink' : 'text-ink/75'}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {icon?.(option)}
                    <span className="min-w-0">
                      <span className="block truncate">{option.label}</span>
                      {option.hint && (
                        <span className="block truncate font-mono text-[10px] text-ink/40">{option.hint}</span>
                      )}
                    </span>
                  </span>
                  {isSelected && <Check size={11} className="mt-0.5 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
