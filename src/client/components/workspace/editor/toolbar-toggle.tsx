/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The editor toolbar's two shared primitives: the icon-button shell and the
 * pressed-state toggle every control in the row is built from.
 *
 * In their own module because both cluster tables (`toolbar-clusters` for the
 * reading aids, `toolbar-write-clusters` for saves and view toggles) draw with
 * them — importing one from the other would be a cycle between two tables that
 * are peers.
 *
 * **Every action is an icon-only `<button>` carrying both a `title` and an
 * `aria-label`** — a bare `<svg onClick>` is unreachable by keyboard and
 * invisible to a screen reader. That rule is the reason this shell exists rather
 * than each call site re-deriving it.
 */

import type { ComponentChildren } from 'preact';

/** Shared icon-button shell. */
export const ACTION_CLASS =
  'flex items-center justify-center p-1.5 rounded transition-colors cursor-pointer disabled:cursor-default disabled:opacity-50';

/** One pressed-state toggle. */
export function Toggle({
  label,
  pressed,
  title,
  onClick,
  children,
}: {
  label: string;
  pressed: boolean;
  title?: string;
  onClick: () => void;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ACTION_CLASS} hover:bg-ink/5 ${pressed ? 'text-ink' : 'hover:text-ink'}`}
      title={title ?? label}
      aria-label={label}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}
