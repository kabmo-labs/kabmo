/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the chat composer LOOKS like, as one of four styles.
 *
 * This is a PRESENTATION choice over one composer, not four composers: every
 * style renders the same controls — the paperclip, the attachment chips, the
 * compact "Type here" target, the stretch control, plan/goal, the notice
 * strip, the draft with its `@`/`/` picker, the dictation notice, the model,
 * thinking and access selectors, plugin actions, voice, stop and send. What
 * changes is the ORDER of the rows and the frame around them.
 *
 * That constraint is the module's reason to exist. A style that could omit a
 * control would be a style that can silently drop the access mode — the one
 * setting that decides whether a turn may write to disk. So the table below
 * names ROWS, never controls: there is no field here that can remove one.
 *
 *  - `classic` — chrome above the draft, controls below it. The shipped card.
 *  - `calm`    — the draft leads; chips and controls sit under it in one
 *                quieter rail.
 *  - `console` — a mono status rail under the box, with an `omp ›` prompt
 *                glyph. The workbench reading of the same controls.
 *  - `stage`   — `classic` inside a chat, a wider hero card while the session
 *                is still empty (see `hero`).
 *
 * Copy lives here with the names; the pixels live with the components that
 * draw them (`chat-input/expansion.ts`, `chat-input/index.tsx`), so neither
 * file restates the other's fact.
 */

export type ComposerStyle = 'classic' | 'calm' | 'console' | 'stage' | 'glass';

/**
 * Every style, in the order the settings control lists them: the cards that
 * keep today's reading order first, then the two that move it, then the one
 * that changes the SURFACE rather than the order.
 */
export const COMPOSER_STYLES = ['classic', 'calm', 'console', 'stage', 'glass'] as const;

/**
 * The style a document with no stored preference renders at. It is the shape
 * Kabmo has always drawn, so an upgrade rearranges nothing.
 */
export const DEFAULT_COMPOSER_STYLE: ComposerStyle = 'classic';

export function isComposerStyle(value: unknown): value is ComposerStyle {
  return value === 'classic' || value === 'calm' || value === 'console' || value === 'stage' || value === 'glass';
}

/**
 * The style to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * falls back to the default rather than to a style no component knows.
 */
export function resolveComposerStyle(value: unknown): ComposerStyle {
  return isComposerStyle(value) ? value : DEFAULT_COMPOSER_STYLE;
}

export interface ComposerStyleCopy {
  label: string;
  /** One line under the label: the TRADEOFF, not the aesthetic. */
  description: string;
}

export const COMPOSER_STYLE_COPY: Record<ComposerStyle, ComposerStyleCopy> = {
  classic: {
    label: 'Classic',
    description: 'Chrome above the draft, controls below it. Every control visible at once — the densest and the most predictable.',
  },
  calm: {
    label: 'Calm',
    description: 'The draft leads, chips and controls sit under it in one quieter rail. Same controls, less chrome above the typing line.',
  },
  console: {
    label: 'Console',
    description: 'A monospace status rail under the box, with an omp prompt glyph. Reads like the rest of the telemetry UI.',
  },
  stage: {
    label: 'Stage',
    description: 'Classic once a chat is running; a wider, taller card while the session is still empty.',
  },
  glass: {
    label: 'Glass',
    description: 'A translucent capsule: the card is frosted paper over whatever sits behind it, with the draft and controls on one surface. Same controls, softer edge.',
  },
};

/**
 * A row of the composer card, in render order. Rows own the pieces that must
 * stay next to each other (the notice belongs to the draft it refuses), and
 * every one of them is always drawn.
 */
export type ComposerRow =
  | 'attachments'
  | 'notice'
  | 'draft'
  | 'voice'
  | 'toolbar';

/** One bar of the settings card's miniature wireframe. */
export type ComposerWireRow = 'chip' | 'draft' | 'controls';

export interface ComposerStyleLayout {
  /** Rows in render order. Every row is rendered; none is optional. */
  rows: readonly ComposerRow[];
  /** Wireframe for the settings card — the same order, drawn small. */
  wire: readonly ComposerWireRow[];
  /**
   * `rail` renders the control row as a monospace status line. The CONTROLS
   * are the same; only the typography and the separators change.
   */
  toolbarTone: 'plain' | 'rail';
  /** Draw the `omp ›` prompt glyph at the card's leading edge. */
  promptGlyph: boolean;
  /** Read by CSS only, through `[data-composer-style]`. */
  attributeValue: ComposerStyle;
  /** Read by CSS only, through `[data-composer-hero]`. */
  hero: boolean;
}

export interface ComposerStyleInput {
  style: ComposerStyle;
  /** Whether the session is still empty; only `stage` reads it. */
  hero: boolean;
}

/**
 * The layout for a style.
 *
 * A pure table: same inputs, same shape, no DOM and no settings read — which is
 * what makes it testable and what lets the renderer stay a loop over `rows`.
 *
 * **It states ORDER and STRUCTURE only, never a Tailwind size.** A style table
 * that wrote `rounded-md` or `min-h-[132px]` would be a table that loses to the
 * expansion frame's own `rounded-xl` / `min-h-[68px]`: Tailwind resolves two
 * utilities of the same property by the order the rules were EMITTED in, not by
 * the order the classes appear in `className`. Measured on the console style,
 * `rounded-xl rounded-md` rendered 12px. The pixels therefore live in CSS,
 * keyed by the attributes below — the same split `data-chat-width` already uses
 * for the chat column.
 */
export function composerStyleLayout({ style, hero }: ComposerStyleInput): ComposerStyleLayout {
  const base = { attributeValue: style, hero: style === 'stage' && hero };

  switch (style) {
    case 'calm':
      return { ...base, rows: ['draft', 'notice', 'attachments', 'voice', 'toolbar'], wire: ['draft', 'chip', 'controls'], toolbarTone: 'plain', promptGlyph: false };

    case 'console':
      return { ...base, rows: ['notice', 'draft', 'attachments', 'voice', 'toolbar'], wire: ['draft', 'chip', 'controls'], toolbarTone: 'rail', promptGlyph: true };

    // The hero card is the only difference, and only while empty: a taller
    // draft so the first prompt is not written into a 68px slot in the middle
    // of a blank screen. Everything else is `classic`.
    case 'stage':
      return { ...base, rows: ['attachments', 'notice', 'draft', 'voice', 'toolbar'], wire: ['chip', 'draft', 'controls'], toolbarTone: 'plain', promptGlyph: false };

    // `glass` is a SURFACE, not an order: it keeps `classic`'s rows and changes
    // only the frame (translucency, blur, a sheen). Stated here rather than
    // implied by the default arm so the intent survives the next style.
    case 'glass':
      return { ...base, rows: ['attachments', 'notice', 'draft', 'voice', 'toolbar'], wire: ['chip', 'draft', 'controls'], toolbarTone: 'plain', promptGlyph: false };

    case 'classic':
    default:
      return { ...base, rows: ['attachments', 'notice', 'draft', 'voice', 'toolbar'], wire: ['chip', 'draft', 'controls'], toolbarTone: 'plain', promptGlyph: false };
  }
}
