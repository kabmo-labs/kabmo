/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's reveal / collapse row, below a workspace's sessions.
 *
 * Split out of `WorkspaceSection.tsx` so that file stays under the repo's
 * per-file ceiling, the same way `mobile-session-sidebar/RevealRow.tsx` was
 * split out of `Item.tsx`. The window itself is the folder hook's
 * (`useShowMore`), so this file owns only the markup.
 *
 * Reveal and collapse are two controls, not one toggle: the list is truncated
 * for height, so after a partial reveal the user needs to keep going AND to
 * start over, which is what two controls say and one alternating control
 * cannot.
 */

import { ChevronDown, ChevronUp } from 'lucide-preact';

interface Props {
  hiddenCount: number;
  canShowLess: boolean;
  onShowMore: () => void;
  onShowLess: () => void;
}

export function WorkspaceRevealRow({ hiddenCount, canShowLess, onShowMore, onShowLess }: Props) {
  if (hiddenCount <= 0 && !canShowLess) return null;

  return (
    <div className="flex items-center gap-1 pl-6">
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={onShowMore}
          className="min-w-0 truncate rounded-md px-1 py-1 text-[11px] text-ink/45 transition-colors cursor-pointer hover:bg-ink/[0.04] hover:text-ink/80"
        >
          <ChevronDown size={11} className="mr-1 inline align-[-2px]" />
          {hiddenCount} more
        </button>
      )}
      {canShowLess && (
        <button
          type="button"
          onClick={onShowLess}
          className="ml-auto shrink-0 rounded-md px-1 py-1 text-[11px] text-ink/45 transition-colors cursor-pointer hover:bg-ink/[0.04] hover:text-ink/80"
        >
          <ChevronUp size={11} className="mr-1 inline align-[-2px]" />
          Less
        </button>
      )}
    </div>
  );
}
