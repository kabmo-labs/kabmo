/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A select whose list can be SEARCHED.
 *
 * A native `<select>` is the right control for five options and the wrong one for
 * two hundred: an agent that publishes 221 models (`omp (ACP)`, measured) turns
 * it into a scroll box with no way to type, and the OS popup is not even the same
 * shape on macOS, Windows and a phone. This keeps the select ROLE and keyboard
 * contract, and adds a filter row.
 *
 * Three rules, each from a measured failure elsewhere in this app:
 *
 *  - **The panel is portalled** (`AnchoredMenu`). A dropdown inside a `z-index`ed
 *    ancestor cannot paint over its siblings — the settings card sits in a
 *    scroller, which clips it — so placement is computed from the viewport.
 *  - **The trigger repeats the chosen label**, not the raw value: a model is
 *    stored as `provider/model` and read as "Claude Sonnet 5".
 *  - **The current value is always offered**, even when the list no longer
 *    contains it (`(not listed)`): a stale default must be visible and
 *    removable, never silently replaced by the first option.
 *
 * `role="combobox"` on the trigger with `aria-controls` to the listbox, so a
 * screen reader hears one control rather than a button and an unrelated list.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, Search } from 'lucide-preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { anchorRectOf, type AnchorRect } from '@/shared/lib/ui/menu-anchor';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';

/** One option: the value stored, and what a reader sees. */
export interface SearchSelectOption {
  value: string;
  label: string;
  /** Shown under the label in the list, not on the trigger. */
  hint?: string;
  /** Rows under one heading stay in the order they were given. */
  group?: string;
}

interface SearchSelectProps {
  value: string;
  options: readonly SearchSelectOption[];
  /** What an empty value means, e.g. "Agent default". */
  placeholder: string;
  /** Names the control for assistive tech and for tests. */
  ariaLabel: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Applies to the trigger, so a caller can match its own field styles. */
  className?: string;
  /** Show a search row at all. A short list reads fine without one. */
  searchable?: boolean;
}

const TRIGGER_CLASS =
  'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-left font-mono text-[11px] text-ink transition-colors hover:border-ink/40 focus:border-ink/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export function SearchSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
  disabled,
  className,
  searchable = true,
}: SearchSelectProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useRef(`search-select-${Math.random().toString(36).slice(2, 9)}`).current;

  const selected = options.find((option) => option.value === value);
  const open = anchor !== null;

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return options;
    return options.filter((option) => matchesPickerQuery(`${option.label} ${option.value} ${option.hint ?? ''}`, needle));
  }, [options, query]);

  /** Rows grouped by `group`, in the order the groups first appear. */
  const groups = useMemo(() => {
    const out: Array<{ name: string; rows: SearchSelectOption[] }> = [];
    for (const option of filtered) {
      const name = option.group ?? '';
      const existing = out.find((group) => group.name === name);
      if (existing) existing.rows.push(option);
      else out.push({ name, rows: [option] });
    }
    return out;
  }, [filtered]);

  const close = (restoreFocus = false) => {
    setAnchor(null);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const openMenu = () => {
    if (disabled || !triggerRef.current) return;
    const index = Math.max(0, options.findIndex((option) => option.value === value));
    setQuery('');
    setActiveIndex(index);
    setAnchor(anchorRectOf(triggerRef.current));
  };

  const commit = (next: string) => {
    if (next !== value) onChange(next);
    close(true);
  };

  // Reset the highlight when the filter changes, so Enter cannot commit a row
  // the reader is no longer looking at.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, Math.min(filtered.length - 1, index + 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) commit(option.value);
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        title={selected?.label ?? placeholder}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`${TRIGGER_CLASS} ${className ?? ''}`}
      >
        <span className={`truncate ${selected ? '' : 'text-ink/40'}`}>
          {selected?.label ?? (value ? `${value} (not listed)` : placeholder)}
        </span>
        <ChevronDown
          size={12}
          className={`flex-shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnchoredMenu
        anchor={anchor}
        align="start"
        className="w-72 max-w-[calc(100vw-2rem)] rounded-md border border-ink/15 bg-paper py-1 text-xs shadow-lg"
        {...{ 'aria-label': ariaLabel }}
        onClose={() => close(true)}
      >
        {/* The keyboard handler lives on the panel: the search input is inside it,
            and a listbox that only answers keys when its own rows have focus is
            unusable with a filter row above them. */}
        <div onKeyDown={onKeyDown}>
          {searchable && (
            <div className="flex items-center gap-1.5 border-b border-ink/10 px-2 py-1.5">
              <Search size={11} className="flex-shrink-0 text-ink/40" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                aria-label={`Search ${ariaLabel}`}
                placeholder="Search…"
                onInput={(event) => setQuery(event.currentTarget.value)}
                className="w-full min-w-0 bg-transparent text-xs text-ink outline-none placeholder:text-ink/35"
              />
            </div>
          )}
          <div id={listboxId} role="listbox" aria-label={ariaLabel} className="max-h-56 overflow-y-auto py-1">
            {/* An empty value is a real choice ("the agent decides"), so it is a
                row like any other — and it stays first, where a native select
                would put it. */}
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              ref={(node) => {
                optionRefs.current[0] = node;
              }}
              onClick={() => commit('')}
              onMouseEnter={() => setActiveIndex(0)}
              className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left ${
                value === '' ? 'text-ink' : 'text-ink/60'
              } hover:bg-ink/5`}
            >
              <span className="truncate italic">{placeholder}</span>
              {value === '' && <Check size={11} className="flex-shrink-0" />}
            </button>
            {/* A stored default the agent no longer publishes: offered so the
                reader can see it and clear it, marked so it is not mistaken for
                a live option. */}
            {value !== '' && !selected && (
              <button
                type="button"
                role="option"
                aria-selected
                onClick={() => commit(value)}
                // Deliberately NOT in the arrow-key order: it is not a member of
                // `filtered`, so giving it a slot in `optionRefs` would make two
                // rows share one index and scroll the wrong one into view.
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-ink"
              >
                <span className="truncate">{value} (not listed)</span>
                <Check size={11} className="flex-shrink-0" />
              </button>
            )}

            {filtered.length === 0 ? (
              <div className="px-3 py-2 italic text-ink/40">No match for “{query.trim()}”</div>
            ) : (
              groups.map((group) => (
                <div key={group.name || '__flat'}>
                  {group.name && (
                    <div className="px-3 pb-0.5 pt-2 text-[9px] font-semibold uppercase tracking-wider text-ink/35">
                      {group.name}
                    </div>
                  )}
                  {group.rows.map((option) => {
                    // Index in the FLAT list is what the arrow keys walk, so the
                    // ref is taken from there and not from the group's own row.
                    const flatIndex = filtered.indexOf(option);
                    const isSelected = option.value === value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        ref={(node) => {
                          optionRefs.current[flatIndex + 1] = node;
                        }}
                        onClick={() => commit(option.value)}
                        onMouseEnter={() => setActiveIndex(flatIndex)}
                        title={option.hint ?? option.value}
                        className={`flex w-full items-start justify-between gap-2 px-3 py-1.5 text-left transition-colors ${
                          flatIndex === activeIndex ? 'bg-ink/5' : ''
                        } ${isSelected ? 'font-medium text-ink' : 'text-ink/75'}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{option.label}</span>
                          {option.hint && (
                            <span className="block truncate font-mono text-[10px] text-ink/40">{option.hint}</span>
                          )}
                        </span>
                        {isSelected && <Check size={11} className="mt-0.5 flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      </AnchoredMenu>
    </>
  );
}
