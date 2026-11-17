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
  /** The glyph, drawn at 14px by the caller. */
  children: ReactNode;
}

export function HeaderButton({ label, onClick, disabled, busy, children }: HeaderButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-busy={busy || undefined}
      className="flex-shrink-0 rounded-md p-1.5 text-ink/80 transition-colors hover:bg-ink/5 disabled:opacity-50"
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
