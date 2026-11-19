/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The row's glyphs, inline.
 *
 * The kit has no icon dependency and neither does this plugin: a `lucide-preact`
 * import would bundle a whole icon set for four shapes. Same convention as the
 * Kabmo's own `RepoPicker` (and the other bundled plugins' icons) — geometry
 * inset 2/24 of the box with a 2/24 stroke, so the marks carry the same ink
 * weight as everything beside them.
 *
 * Paint is `currentColor`, which is what lets one glyph serve both a pressed and
 * an unpressed toggle: the surrounding text colour is the state.
 */

/**
 * One glyph. `size` defaults to the row's own 12px.
 *
 * `path` is one `d`, or several — a mark from an icon set that draws it as
 * separate subpaths (lucide's refresh arrow does) keeps that shape, so the
 * plugin's glyph and the host's are the same geometry rather than two drawings
 * that look alike.
 */
export function Glyph({ path, size = 12 }: { path: string | readonly string[]; size?: number }) {
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
      {(typeof path === 'string' ? [path] : path).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/**
 * The shapes, in one table.
 *
 * - `play` / `stop` are the Run control: a triangle to start, a square to end.
 * - `output` is three lines of a log — "keep the output in this row".
 * - `background` is a clock — "this one keeps running", which is what a job is.
 *   A detached arrow was the other candidate and reads as "open elsewhere".
 */
export const ICON = {
  play: 'm5 3 14 9-14 9z',
  stop: 'M6 6h12v12H6z',
  output: 'M4 6h16M4 12h16M4 18h9',
  background: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l4 2',
  // The Files panel's refresh glyph — `RefreshCw` from `lucide-preact`, which
  // the host's own `RefreshButton` draws — copied as its four subpaths. A plugin
  // cannot import lucide (the host hands it only its two `@kabmo-labs/*`
  // packages), so the geometry is what is shared.
  refresh: [
    'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8',
    'M21 3v5h-5',
    'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16',
    'M8 16H3v5',
  ],
  /** A pencil — "edit this stored command". */
  edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  /** A bin — "delete this stored command". */
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  /** A plus — "add one of your own". */
  plus: 'M12 5v14M5 12h14',
  /** The panel's own mark, matching `icon.svg`: a framed play button. */
  runner: 'M3 3h18v18H3zM9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z',
} as const;
