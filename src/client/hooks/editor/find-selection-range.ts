/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The range an "in selection" search is restricted to.
 *
 * Captured when the toggle is ARMED, never read live: a range the user then moves would
 * silently change what is searched, which is the opposite of what the toggle says it
 * does. Disarming drops it, so a later arm takes whatever is selected THEN rather than
 * a stale range.
 *
 * `arm` answers false when nothing is selected — a toggle that promised "the selection"
 * and searched the whole document instead would be a lie about the count.
 */

import { useCallback, useState } from 'preact/hooks';

export interface SelectionRange {
  start: number;
  end: number;
}

export interface FindSelectionRange {
  /** The captured range, or null while the toggle is off. */
  range: SelectionRange | null;
  /** Capture `readSelection()`; false when there is nothing selected to capture. */
  arm: (readSelection: () => SelectionRange | null) => boolean;
  disarm: () => void;
}

export function useSelectionRange(): FindSelectionRange {
  const [range, setRange] = useState<SelectionRange | null>(null);

  const arm = useCallback((readSelection: () => SelectionRange | null) => {
    const selection = readSelection();
    if (!selection || selection.start === selection.end) {
      setRange(null);
      return false;
    }
    setRange(selection);
    return true;
  }, []);

  const disarm = useCallback(() => setRange(null), []);

  return { range, arm, disarm };
}
