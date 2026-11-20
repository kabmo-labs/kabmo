/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the app's HAIRLINES are drawn, as ONE of two styles.
 *
 * This is a PRESENTATION choice over the same shell, exactly like
 * `surface-style.ts`: both styles draw the same panels, rows, controls and
 * dialogs, and only the thin rules between them change. Nothing is hidden,
 * moved or re-ordered.
 *
 * Two facts decide the whole design, each measured against the running app
 * (Chromium, 1440x900, `onedarkpro-light`, `glass`):
 *
 * 1. **There is no single hairline token to switch.** 2,126 `border-*` classes
 *    across 403 files write their rung by hand (`/5 /6 /8 /10 /12 /15 /20` =
 *    1,169 of them), and `glass.css` only restates `border-color` for
 *    `.glass-chrome` / `.glass-overlay` / `.glass-popover`. A setting cannot
 *    rewrite 403 files, so it has to OVERRIDE the utilities in one place.
 *
 * 2. **A hairline and a control's edge are different facts, and only the
 *    first may vanish.** The rungs split cleanly by role, measured per class
 *    string rather than by eye:
 *
 *    | Rung        | Count | What it draws                                        |
 *    |-------------|-------|------------------------------------------------------|
 *    | `/5`–`/12`  | 175   | separators: `border-b` under a header, a column's `border-r`, a table row's rule |
 *    | `/15`       | 313   | BOTH: a panel's outer edge and a chip's edge         |
 *    | `/20`       | 256   | a card's outline, a chip's outline, an input's edge   |
 *    | `/25`–`/60` | 371   | interaction: hover, focus, focus-within, an active chip |
 *
 *    So `borderless` clears `/5`–`/20` and keeps everything from `/25` up. A
 *    focus ring that no longer appears is a WCAG failure (`DESIGN.md` §7), and
 *    a field with no edge is not a calmer field — the form controls are exempted
 *    by tag in `borders.css`, not by leaving their rung painted.
 *
 * `border-dashed`, `border-error`/`-warning`/`-success`/`-info`, `ring-*`,
 * `divide-*` and `.kabmo-checkbox` are deliberately untouched: a drop zone, a
 * validation state and a checkbox's unchecked ring are not decoration.
 *
 * The style reaches the document as `data-borders` on `<html>`, never as a
 * prop, for the same reason as the surface material: the sidebar, the navbar,
 * the composer and every modal are separate subtrees, and a prop would be one
 * call site each — the exact shape that lets one surface keep its rules while
 * the rest drop theirs.
 */

export type BorderStyle = 'hairline' | 'borderless';

/** The style a fresh install — or any stored value this build cannot draw — resolves to. */
export const DEFAULT_BORDER_STYLE: BorderStyle = 'hairline';

/**
 * The style CSS paints when `data-borders` is absent.
 *
 * `hairline` is what every rule in `tailwind.css` already states, so its writer
 * REMOVES the attribute rather than writing it: a document carrying
 * `data-borders="hairline"` and a document carrying nothing are the same state.
 * Kept as its own constant because it is NOT the default in general — a later
 * release may make `borderless` the shipped default, and every comparison must
 * be against the state CSS actually paints.
 */
export const BORDER_STYLE_WITHOUT_ATTRIBUTE: BorderStyle = 'hairline';

/** Document attribute carrying the style. Read by CSS only. */
export const BORDER_ATTRIBUTE = 'data-borders';

/**
 * `app_settings` key holding the style, in the `kabmo_settings` blob.
 *
 * Declared HERE, beside the type and the copy, because two processes read it:
 * the browser (`client/hooks/ui/border-style.ts`) and the SSR shell that paints
 * the first frame (`server/lib/assets/shell-attributes.server.ts`). A key
 * spelled at both ends is a setting that saves and never loads.
 */
export const BORDER_STYLE_SETTING_KEY = 'borderStyle';

/** Every style, in the order the settings control lists them. */
export const BORDER_STYLES = ['hairline', 'borderless'] as const;

/** A stored value written by another build is not a style this one can draw. */
export function isBorderStyle(value: unknown): value is BorderStyle {
  return value === 'hairline' || value === 'borderless';
}

/**
 * The style to APPLY for a stored value.
 *
 * Anything this build cannot draw — a value from a newer build, a corrupted
 * blob, `undefined` on an upgrade — resolves to `hairline`, which is the look
 * every existing install already has. An upgrade must not silently remove the
 * separators a user has been reading.
 */
export function resolveBorderStyle(value: unknown): BorderStyle {
  return isBorderStyle(value) ? value : DEFAULT_BORDER_STYLE;
}

export interface BorderStyleCopy {
  /** Card title. */
  label: string;
  /** One line under the title: the tradeoff, not the aesthetic. */
  description: string;
  /** The card's caption, so the miniature is not the only cue. */
  caption: string;
}

export const BORDER_STYLE_COPY: Record<BorderStyle, BorderStyleCopy> = {
  hairline: {
    label: 'Hairline',
    description:
      'Thin rules separate the panels, the columns and the rows. Inputs keep their edge and focus keeps its ring.',
    caption: 'Rules on',
  },
  borderless: {
    label: 'Borderless',
    description:
      'The rules between panels, columns, cards and rows are removed; spacing and the panel tints carry the structure. Fields and switches keep their edge.',
    caption: 'Rules off',
  },
};
