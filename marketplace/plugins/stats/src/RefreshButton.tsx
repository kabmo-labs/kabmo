/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's refresh control: the glyph and the button.
 *
 * The glyph is drawn INLINE rather than imported, and that is a build fact
 * rather than a preference: the kit ships no icon set, and a plugin's
 * `node_modules` carries only the two `@ompchamber/*` packages the host links
 * into it — `lucide-preact` is the HOST's own dependency, so importing it would
 * make this plugin's build depend on a package it was never given. One path is
 * cheaper than that dependency.
 *
 * The button owns its own `disabled` state from the caller's `refreshing`, so a
 * second click cannot queue a second sample while the first is in flight.
 */

interface RefreshButtonProps {
  onRefresh: () => void;
  refreshing: boolean;
  /** Extra classes on the button, for a caller placing it in its own row. */
  className?: string;
}

export function RefreshButton({ onRefresh, refreshing, className = '' }: RefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      disabled={refreshing}
      title="Take a sample now"
      aria-label="Refresh stats"
      class={`p-1 rounded text-ink/45 hover:text-ink hover:bg-ink/5 transition-colors disabled:opacity-50 disabled:cursor-default ${className}`}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        class={refreshing ? 'animate-spin' : undefined}
        aria-hidden="true"
      >
        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M3 21v-5h5" />
      </svg>
    </button>
  );
}
