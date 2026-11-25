/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A select whose list can be SEARCHED — the ONE picker in this app.
 *
 * A native `<select>` is the right control for five options and the wrong one for
 * two hundred: an agent that publishes 221 models (`omp (ACP)`, measured) turns
 * it into a scroll box with no way to type, and the OS popup is not even the same
 * shape on macOS, Windows and a phone. This keeps the select ROLE and keyboard
 * contract, and adds a filter row.
 *
 * The look is the workspace dropdown's (`target-picker/WorkspacePicker`), because
 * that is the control users already read as "pick one of these": a heading, a
 * search row, grouped rows with a mark, a check on the current value, and a
 * fixed action under the list. Every other picker used to be its own variant of
 * that shape; they now come through here.
 *
 * Rules, each from a measured failure elsewhere in this app:
 *
 *  - **The panel is portalled** (`AnchoredMenu`). A dropdown inside a `z-index`ed
 *    ancestor cannot paint over its siblings — the settings card sits in a
 *    scroller, which clips it — so placement is computed from the viewport.
 *  - **The trigger repeats the chosen label**, not the raw value: a model is
 *    stored as `provider/model` and read as "the model 5".
 *  - **The current value is always offered**, even when the list no longer
 *    contains it (`(not listed)`): a stale default must be visible and
 *    removable, never silently replaced by the first option.
 *  - **The empty value is a choice only when the caller says so** (`allowEmpty`).
 *    A timezone always has a value; an agent default may not.
 *
 * `role="combobox"` on the trigger with `aria-controls` to the listbox, so a
 * screen reader hears one control rather than a button and an unrelated list.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { ChevronDown } from 'lucide-preact';
import { AnchoredMenu } from '@/client/components/common/anchored-menu';
import { PickerSearch } from '@/client/components/common/picker-search';
import { OptionList, type OptionGroup } from '@/client/components/common/search-select/OptionList';
import type { SearchSelectOption } from '@/client/components/common/search-select/option';
import { anchorRectOf, type AnchorRect, type MenuAlign } from '@/shared/lib/ui/menu-anchor';
import { matchesPickerQuery } from '@/shared/lib/ui/picker-filter';

export type { SearchSelectOption };

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
  /** Whether the empty value is a real choice (drawn as the first row). */
  allowEmpty?: boolean;
  /** A mark per row, repeated on the trigger for the chosen row. */
  icon?: (option: SearchSelectOption) => ComponentChildren;
  /** The mark the trigger draws while nothing is chosen. */
  emptyIcon?: ComponentChildren;
  /** Uppercase line at the top of the panel, naming the question. */
  heading?: string;
  /** Fixed actions under the list (a create row). */
  footer?: ComponentChildren;
  /** The list holds no options at all. */
  emptyText?: string;
  searchPlaceholder?: string;
  /**
   * `field` is a bordered form control; `chip` is the inline control the
   * composer and the sidebar draw. Same panel either way.
   */
  variant?: 'field' | 'chip';
  /** Panel width; the caller knows the column it opens into. */
  panelClassName?: string;
  align?: MenuAlign;
  /**
   * Words on the trigger when they are not the chosen option's label — a value
   * the caller resolves itself (a project path read as a project name).
   */
  triggerLabel?: string;
  /**
   * The trigger is its mark alone (a 22px sidebar slot). The accessible name
   * still carries the label, so the glyph is never the only answer.
   */
  iconOnly?: boolean;
  /**
   * Replaces the variant's trigger chrome entirely, for a control that already
   * has its own field style (the settings band's project picker). `className`
   * still appends.
   */
  triggerClassName?: string;
}

const TRIGGER_FIELD =
  'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-ink/20 bg-paper px-2 py-1.5 text-left font-mono text-[11px] text-ink transition-colors hover:border-ink/40 focus:border-ink/50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
const TRIGGER_CHIP =
  'tap-chip group flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs font-medium transition-all focus-visible:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50';
const TRIGGER_ICON =
  'tap-chip flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50';

export function SearchSelect({
  value,
  options,
  placeholder,
  ariaLabel,
  onChange,
  disabled,
  className,
  searchable = true,
  allowEmpty = true,
  icon,
  emptyIcon,
  heading,
  footer,
  emptyText = 'No options available',
  searchPlaceholder = 'Search…',
  variant = 'field',
  panelClassName,
  align = 'start',
  triggerLabel,
  iconOnly = false,
  triggerClassName,
}: SearchSelectProps) {
  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useRef(`search-select-${Math.random().toString(36).slice(2, 9)}`).current;

  const selected = options.find((option) => option.value === value);
  const open = anchor !== null;
  const label = triggerLabel ?? selected?.label ?? (value ? `${value} (not listed)` : placeholder);

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return options;
    return options.filter((option) => matchesPickerQuery(`${option.label} ${option.value} ${option.hint ?? ''}`, needle));
  }, [options, query]);

  /** Rows grouped by `group`, in the order the groups first appear. */
  const groups = useMemo(() => {
    const out: OptionGroup[] = [];
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
    optionRefs.current[activeIndex + (allowEmpty ? 1 : 0)]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, allowEmpty]);

  // A searchable panel focuses its field; a short list without one focuses the
  // panel itself, so the arrow keys still reach the row handler.
  useEffect(() => {
    if (!open || searchable) return;
    panelRef.current?.focus();
  }, [open, searchable]);

  /** Walk the filtered rows, stepping over options the caller disabled. */
  const move = (delta: number) => {
    setActiveIndex((index) => {
      for (let next = index + delta; next >= 0 && next < filtered.length; next += delta) {
        if (!filtered[next]?.disabled) return next;
      }
      // No enabled row in that direction: the highlight stays put, so Enter
      // cannot commit a row the list is refusing.
      return index;
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      move(1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      move(-1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(0, filtered.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option && !option.disabled) commit(option.value);
    }
  };

  const isChip = variant === 'chip';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={isChip ? `${ariaLabel}: ${label}` : ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        title={label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openMenu();
          }
        }}
        className={`${
          triggerClassName
          ?? `${isChip ? (iconOnly ? TRIGGER_ICON : TRIGGER_CHIP) : TRIGGER_FIELD} ${
            isChip && selected ? 'bg-ink/10 text-ink' : isChip ? 'text-muted hover:bg-ink/5 hover:text-ink' : ''
          }`
        } ${className ?? ''}`}
      >
        {iconOnly ? (
          selected ? icon?.(selected) : emptyIcon
        ) : (
          <>
            <span className="flex min-w-0 items-center gap-1.5">
              {icon && (selected ? icon(selected) : emptyIcon)}
              <span className={`truncate tracking-tight ${!isChip && !selected && !value ? 'text-ink/40' : ''}`}>
                {label}
              </span>
            </span>
            <ChevronDown
              size={isChip ? 13 : 12}
              className={`flex-shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180 text-ink/70' : ''}`}
            />
          </>
        )}
      </button>

      <AnchoredMenu
        anchor={anchor}
        align={align}
        className={`${panelClassName ?? 'w-72 max-w-[calc(100vw-2rem)]'} rounded-md border border-ink/15 bg-paper py-1 text-xs shadow-lg`}
        {...{ 'aria-label': ariaLabel }}
        onClose={() => close(true)}
      >
        {/* The keyboard handler lives on the panel: the search input is inside
            it, and a listbox that only answers keys when its own rows have focus
            is unusable with a filter row above them. */}
        <div ref={panelRef} tabIndex={searchable ? undefined : -1} onKeyDown={onKeyDown} className="outline-none">
          {heading && (
            <div className="border-b border-ink/5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink/40">
              {heading}
            </div>
          )}
          {searchable ? (
            <PickerSearch
              value={query}
              onChange={setQuery}
              ariaLabel={`Search ${ariaLabel}`}
              placeholder={searchPlaceholder}
            />
          ) : null}
          <OptionList
            listboxId={listboxId}
            ariaLabel={ariaLabel}
            value={value}
            placeholder={placeholder}
            allowEmpty={allowEmpty}
            hasSelected={Boolean(selected)}
            filtered={filtered}
            groups={groups}
            query={query}
            emptyText={emptyText}
            activeIndex={activeIndex}
            optionRefs={optionRefs}
            icon={icon}
            onCommit={commit}
            onHover={setActiveIndex}
          />
          {footer ? <div className="border-t border-ink/5 pt-1">{footer}</div> : null}
        </div>
      </AnchoredMenu>
    </>
  );
}
