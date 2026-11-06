/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two small controls this page needs, in their own file so the page itself
 * reads as sections rather than as markup.
 */

import { Search, X } from 'lucide-preact';

interface SettingsSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

/** A search field with a clear button, matching the settings sidebar's one. */
export function SettingsSearchField({ value, onChange, placeholder }: SettingsSearchFieldProps) {
  return (
    <div className="relative flex min-w-[14rem] flex-1 items-center">
      <Search size={13} className="pointer-events-none absolute left-2.5 text-ink/40" />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        className="w-full rounded-md border border-ink/20 bg-paper py-1.5 pl-7 pr-7 text-xs text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-ink/50"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title="Clear search"
          aria-label="Clear search"
          className="absolute right-1.5 cursor-pointer rounded p-0.5 text-ink/40 transition-colors hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
