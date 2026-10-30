/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer card's FRAME, as one component.
 *
 * Every style renders the same five rows — attachments, notice, draft, voice,
 * toolbar — and the only thing that differs is their order
 * (`composerStyleLayout().rows`). Rendering that order here, rather than with a
 * second copy of the JSX per style, is what makes "no control can go missing"
 * structural instead of a review checklist: a row absent from `rows` is a row
 * this file never renders, and the table is asserted to contain all five.
 *
 * The card's POSITION and stretch semantics are not decided here: they come
 * from `composerExpansion`, which already owns the two layout answers (phone
 * takes the viewport, desktop grows in place), the keyboard inset and the
 * popup placement. This file adds the style's own attributes and keeps the two
 * surfaces that describe the CARD — the goal strip and the drag overlay — above
 * every row, because they do not belong to a line of it.
 *
 * **The style's pixels are CSS, not classes** (`[data-composer-style]` in
 * `tailwind.css`): two utilities of the same property resolve by emission
 * order, so a style writing `rounded-md` beside the frame's `rounded-xl`
 * rendered 12px (measured). The attributes below are the whole handshake.
 */

import { Fragment } from 'preact';
import type { ComponentChildren } from 'preact';
import type { CSSProperties, RefObject } from 'preact/compat';
import type { FileDropProps } from '@/client/hooks/chat/composer/file-drop';
import type { ComposerRow, ComposerStyleLayout } from '@/shared/lib/chat/composer/style';

export interface ComposerFrameProps {
  layout: ComposerStyleLayout;
  /** Position, frame, radius, elevation — resolved by `composerExpansion`. */
  cardClass: string;
  /** The keyboard inset / safe-area padding, when the layout states one. */
  style?: CSSProperties;
  /** Extra classes from the caller (`ChatInput.className`). */
  className?: string;
  /** The card element: the compact hook, the keyboard inset and focus read it. */
  cardRef: RefObject<HTMLDivElement>;
  /**
   * The card currently fills the viewport (the phone's stretched composer).
   * Written as an attribute because a style's radius is plain CSS and would
   * otherwise beat the expansion frame's `rounded-none` — measured: a stretched
   * `glass` card kept a 20px radius over a `fixed inset-0` surface, showing the
   * canvas at its corners.
   */
  expanded?: boolean;
  /** Preact maps these to the bubble-phase events (`onFocusIn`/`onFocusOut`). */
  onFocusIn: () => void;
  onFocusOut: () => void;
  onPointerDown: (event: PointerEvent) => void;
  dropProps: FileDropProps;
  /** Goal strip, drag overlay — above every row, in every style. */
  header?: ComponentChildren;
  rows: Record<ComposerRow, ComponentChildren>;
}

export function ComposerFrame({
  layout,
  cardClass,
  style,
  className = '',
  cardRef,
  expanded = false,
  onFocusIn,
  onFocusOut,
  onPointerDown,
  dropProps,
  header,
  rows,
}: ComposerFrameProps) {
  return (
    <div
      ref={cardRef}
      data-composer-style={layout.attributeValue}
      data-composer-hero={layout.hero ? 'true' : undefined}
      data-composer-expanded={expanded ? 'true' : undefined}
      // NO position utility here: `cardClass` carries `cardPositionClass`, and
      // Tailwind's position utilities are ordered `static, fixed, absolute,
      // relative, sticky` — a `relative` written in this base list would WIN
      // over the `fixed inset-0` a stretched phone composer adds (measured in
      // `expansion.ts`).
      className={`@container transition-colors flex flex-col ${cardClass} ${className}`}
      style={style}
      onFocusIn={onFocusIn}
      onFocusOut={onFocusOut}
      onPointerDown={onPointerDown}
      {...dropProps}
    >
      {header}
      {layout.promptGlyph && (
        // The console style's prompt glyph: decoration that names the surface,
        // so it is inert to the pointer and hidden from the accessibility tree.
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-5 left-2 font-mono text-[11px] text-ink/35"
        >
          omp ›
        </span>
      )}
      {layout.rows.map((row) => (
        <Fragment key={row}>{rows[row]}</Fragment>
      ))}
    </div>
  );
}
