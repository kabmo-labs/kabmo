/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One icon control in a header, and the refresh/reload variant of it.
 *
 * The box is a density fact, not a workspace one: a right-panel strip and a
 * settings pane both draw a 26px bordered square, and the two surfaces used to
 * pick different paddings for the same action — a bordered 24px box on Context,
 * Usage and Todos, a borderless 22px glyph on Git, Wiki and Plan, a 26px box on
 * Files, and a 22px one on the marketplace rows. Stating it once is what keeps
 * the reload glyphs on one line when surfaces are compared.
 *
 * The accessible name is required: an icon-only control with no name is
 * unreachable to a screen reader, and the label is also the tooltip so the two
 * cannot say different things.
 */

import { RefreshCw } from 'lucide-preact';
import type { ReactNode } from 'preact/compat';

interface HeaderButtonProps {
  /** The accessible name, also used as the tooltip. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Marks the control busy for assistive tech while its read is in flight. */
  busy?: boolean;
  /**
   * A toggle's ON state. Left undefined for a plain action — an unconditional
   * `aria-pressed` would announce a state the button does not have. The pressed
   * look holds the hover fill, so the state survives the pointer leaving.
   */
  pressed?: boolean;
  /** The glyph, drawn at 14px by the caller. */
  children: ReactNode;
}

export function HeaderButton({ label, onClick, disabled, busy, pressed, children }: HeaderButtonProps) {
  const pressedClass = pressed ? 'bg-ink/10 text-ink' : 'text-ink/80 hover:bg-ink/5';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-busy={busy || undefined}
      aria-pressed={pressed === undefined ? undefined : pressed}
      className={`flex-shrink-0 rounded-md p-1.5 transition-colors disabled:opacity-50 ${pressedClass}`}
    >
      {children}
    </button>
  );
}

interface RefreshButtonProps {
  /** The accessible name, also used as the tooltip. */
  label: string;
  onClick: () => void;
  /** Spins the glyph while a read is in flight. */
  busy?: boolean;
  disabled?: boolean;
}

/** The header's refresh/reload control: `HeaderButton` with the shared glyph. */
export function RefreshButton({ label, onClick, busy = false, disabled }: RefreshButtonProps) {
  return (
    <HeaderButton label={label} onClick={onClick} disabled={disabled} busy={busy}>
      <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
    </HeaderButton>
  );
}
