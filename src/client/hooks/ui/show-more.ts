/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * "Show more" / "Show less" pagination shared by the desktop workspace
 * category and the mobile workspace item. Both reveal the same counts
 * (initial 5, step 7), so the numbers live here rather than being repeated per
 * call site.
 *
 * The two controls are NOT inverses: `showMore` grows the window by `step`
 * (revealing rows past the boundary), while `showLess` collapses it straight
 * back to `initial` — one click closes whatever several clicks opened. That is
 * why both are offered at once rather than as a single toggling control: after
 * a partial reveal the list is still truncated, so the user needs to be able to
 * keep going AND to start over.
 */

import { useCallback, useState } from 'preact/hooks';

export interface ShowMore {
  visibleCount: number;
  showMore: () => void;
  showLess: () => void;
  /** True once the window has grown past its initial size — i.e. `showLess` has work to do. */
  canShowLess: boolean;
}

export function useShowMore(initial = 5, step = 7): ShowMore {
  const [visibleCount, setVisibleCount] = useState(initial);
  const showMore = useCallback(() => setVisibleCount((c) => c + step), [step]);
  const showLess = useCallback(() => setVisibleCount(initial), [initial]);
  return { visibleCount, showMore, showLess, canShowLess: visibleCount > initial };
}
