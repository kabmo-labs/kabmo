/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The filter row inside a composer picker.
 *
 * Every popover in the composer's target pair answers the same question — "which
 * of these N rows is the one I meant" — and each used to be a plain scroller. The
 * row is one component so the three controls cannot drift into three looks, and
 * so the field can be given the popover's own border and height rather than a
 * per-control approximation.
 *
 * Focus is taken on mount: the row only exists while the popover is open, so the
 * user's next keystroke is a query instead of an arrow key walk.
 */

import { useEffect, useRef } from 'preact/hooks';
import { Search, X } from 'lucide-preact';

interface PickerSearchProps {
  value: string;
  onChange: (value: string) => void;
  /** Names both the field and its clear control. */
  ariaLabel: string;
  placeholder?: string;
}

export function PickerSearch({ value, onChange, ariaLabel, placeholder = 'Search…' }: PickerSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-1.5 border-b border-ink/5 px-2.5 py-1.5">
      <Search size={11} className="shrink-0 text-ink/35" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onInput={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          // The popover is inside a form-less composer; Escape closing the field
          // is the one key a reader presses without thinking.
          if (event.key === 'Escape') {
            event.preventDefault();
            onChange('');
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink/35"
      />
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear search"
          aria-label="Clear search"
          className="shrink-0 rounded p-0.5 text-ink/40 transition-colors cursor-pointer hover:bg-ink/10 hover:text-ink"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
