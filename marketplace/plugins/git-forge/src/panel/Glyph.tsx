/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's glyphs, inline.
 *
 * The kit has no icon dependency and neither does this plugin: a `lucide-preact`
 * import would bundle a whole icon set for a dozen shapes. Same convention as the
 * Kabmo's own `RepoPicker` and the other bundled plugins' icons — geometry inset
 * 2/24 of the box with a 2/24 stroke, so the marks carry the same ink weight as
 * everything beside them. Paint is `currentColor`, so the surrounding text colour
 * is the state.
 */

export function Glyph({ path, size = 12 }: { path: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export const ICON = {
  /** The panel's own mark, matching `icon.svg`. */
  forge: 'M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7M6 9v12',
  refresh: 'M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2M3 4v5h5M21 20v-5h-5',
  back: 'M19 12H5M12 19l-7-7 7-7',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  comment: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.9 8.5 8.5 0 0 1 8.5-8.5 8.4 8.4 0 0 1 8.5 8z',
  /** An open circle — an issue that is open. */
  issueOpen: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v8M8 12h8',
  /** A ticked circle — an issue that is closed. */
  issueClosed: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM8 12l3 3 5-5',
  /** A merge request. */
  pull: 'M6 9v12M6 6a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM13 6h3a2 2 0 0 1 2 2v7',
  /** A tag — a release. */
  release: 'M20.6 13.4 12 22l-9-9V4h9l8.6 8.6a1.4 1.4 0 0 1 0 1.8zM7.5 7.5h.01',
  /** A funnel — "there are filters on". */
  filter: 'M22 3H2l8 9.46V19l4 2v-8.54z',
  /** A ticked circle — a passing pipeline. */
  check: 'M22 11.08V12a10 10 0 1 1-5.93-9.14M22 4 12 14.01l-3-3',
  /** A cross — a failing pipeline. */
  cross: 'M18 6 6 18M6 6l12 12',
  /** A clock — a pipeline still running. */
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  /** A dash — a verdict with nothing to say. */
  dash: 'M5 12h14',
  /** A file — one entry of a change. */
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6',
  /** A commit — a dot on a line. */
  commit: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 12h7M15 12h7',
  /** A speech bubble with a plus — "add a comment". */
  commentAdd: 'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5a8.4 8.4 0 0 1-.9-3.9 8.5 8.5 0 0 1 8.5-8.5 8.4 8.4 0 0 1 8.5 8zM12 8v6M9 11h6',
  /** A merge arrow — "merge this". */
  merge: 'M8 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 12V3M8 12c6 0 8-3 8-6',
} as const;
