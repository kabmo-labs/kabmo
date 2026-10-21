/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The drawer's reveal / collapse row, below a workspace's sessions.
 *
 * Split out of `Item.tsx` (which is the folder row AND its list) so that file
 * stays under the repo's per-file ceiling. Parity with the desktop category is
 * the whole point: the same window, so the phone cannot offer a different
 * boundary than the sidebar.
 *
 * The chevron starts at the list's own gutter — the same x as a session row's
 * status slot and the folder header's icon — because the list carries no
 * `pl-2` of its own any more. The label then lands on the title column
 * (16px slot + 8px gap).
 */

import { ChevronDown, ChevronUp } from 'lucide-preact';

interface Props {
  hiddenCount: number;
  canShowLess: boolean;
  onShowMore: () => void;
  onShowLess: () => void;
}

export function SessionRevealRow({ hiddenCount, canShowLess, onShowMore, onShowLess }: Props) {
  if (hiddenCount <= 0 && !canShowLess) return null;

  return (
    <div className="flex items-center gap-1">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="flex items-center min-w-0 text-left py-2 pr-3 text-xs text-ink/60 hover:text-ink"
        >
          <span className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <ChevronDown size={12} />
          </span>
          <span className="w-2 shrink-0" />
          <span className="truncate">Show more sessions ({hiddenCount})</span>
        </button>
      )}

      {canShowLess && (
        <button
          type="button"
          onClick={onShowLess}
          className="ml-auto shrink-0 flex items-center gap-1 text-xs text-ink/60 hover:text-ink pl-3 py-2"
        >
          <ChevronUp size={12} />
          <span className="truncate">Show less</span>
        </button>
      )}
    </div>
  );
}
