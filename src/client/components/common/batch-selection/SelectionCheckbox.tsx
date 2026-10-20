/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The checkbox a sidebar row grows while a batch selection is active.
 *
 * A native `<input type="checkbox">` rather than a styled span: it carries the
 * checked/indeterminate state, the keyboard behaviour and the announcement for
 * free, and `indeterminate` (a workspace whose sessions are partly selected) is
 * a DOM PROPERTY with no attribute equivalent — it has to be assigned, which is
 * what the ref below is for.
 *
 * The click is stopped from propagating: the control sits inside a row that
 * selects or expands on click, so a checkbox that bubbled would do both.
 */

import { useEffect, useRef } from 'preact/hooks';

export interface SelectionCheckboxProps {
  checked: boolean;
  /** Draw the dash state (a header whose children are partly selected). */
  indeterminate?: boolean;
  /** The accessible name — every row's checkbox names the row it belongs to. */
  label: string;
  onChange: () => void;
  /** `sm` is the row-sized control; `md` is the header's. */
  size?: 'sm' | 'md';
}

export function SelectionCheckbox({
  checked,
  indeterminate = false,
  label,
  onChange,
  size = 'sm',
}: SelectionCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
      className={`shrink-0 accent-ink cursor-pointer rounded border-ink/30 ${
        size === 'md' ? 'w-3.5 h-3.5' : 'w-3 h-3'
      }`}
    />
  );
}
