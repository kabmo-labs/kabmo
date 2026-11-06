/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two small controls this page needs, in their own file so the page itself
 * reads as sections rather than as markup.
 */

import { AlertCircle, Search, X } from 'lucide-preact';

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

interface SettingsNoticeProps {
  message: string;
  /** Dismiss this notice. Omitted by a notice that has nothing to dismiss. */
  onDismiss?: () => void;
  /** The dismiss control's accessible name, so it says WHICH notice closes. */
  dismissLabel?: string;
}

/**
 * A refusal stated in place, with a way out of it.
 *
 * The banner is not a toast: a switch or probe refusal is the agent's own words
 * (`Run mcode login`, `executable not found (command: pi)`), and a toast would
 * close before they could be read. That also means it must be dismissible —
 * an error that only leaves when the next action succeeds sits on the page
 * forever, and on a switch that keeps failing it becomes part of the furniture.
 *
 * Dismissing hides the MESSAGE, never the state: the row's `not installed`
 * chip and its disabled `Check` still say what is true.
 */
export function SettingsNotice({ message, onDismiss, dismissLabel = 'Dismiss message' }: SettingsNoticeProps) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-ink/15 bg-ink/[0.03] p-3 text-[11px] text-ink/70">
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          title={dismissLabel}
          aria-label={dismissLabel}
          className="-m-0.5 shrink-0 cursor-pointer rounded p-0.5 text-ink/40 transition-colors hover:text-ink"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}
