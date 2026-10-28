/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reveal state for a tool output rendered through `outputWindow`.
 *
 * The counter is the number of lines the reader has asked to see; the policy
 * (`outputWindow` / `revealMore` in `shared/lib/chat/tool/output-window.ts`)
 * turns it into the mounted slice. Keeping the counter here rather than in each
 * panel means every long output — bash, eval, a search result, a fallback block
 * — reveals by the same amount and stops at the same ceiling.
 */

import { useCallback, useState } from 'preact/hooks';
import { OUTPUT_WINDOW_INITIAL, revealMore } from '@/shared/lib/chat/tool/output-window';

export interface OutputReveal {
  /** Lines currently requested; feed straight into `outputWindow`. */
  revealed: number;
  /** One step more, clamped at the ceiling. */
  reveal: () => void;
}

export function useOutputReveal(total: number, initial: number = OUTPUT_WINDOW_INITIAL): OutputReveal {
  const [revealed, setRevealed] = useState(initial);
  const reveal = useCallback(() => setRevealed((current) => revealMore(current, total)), [total]);
  return { revealed, reveal };
}
