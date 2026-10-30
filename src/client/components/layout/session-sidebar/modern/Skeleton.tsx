/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's placeholder for the list area while the first fetch is
 * in flight.
 *
 * It draws ONLY the list: the search line, the chips and the action row above
 * it are real controls that render during initialization too, and a skeleton
 * that drew its own copies of them put two search fields on screen for a beat
 * and then moved the real one. The earlier version also carried its own
 * `px-2 pb-3` while the view already padded the same box — 8px of double inset,
 * visible as the placeholder sitting narrower than the rows it stood in for.
 *
 * The geometry is the live geometry, measured rather than approximated: the
 * workspace header is 26px (32 on touch) with its mark in the same 4px + 16px
 * (18px) gutter the real header uses, and the rows are 31px (32 on touch, the
 * header's own `h-8` — see `common/session-row`) — the live row's own measured
 * height, not `padding + bar`. A placeholder whose heights differ from the
 * content is a layout shift with extra steps.
 */

const PLACEHOLDER_FOLDERS = [3, 2];

export function ModernSidebarSkeleton({ touch = false }: { touch?: boolean }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {PLACEHOLDER_FOLDERS.map((rows, folderIndex) => (
        <div key={folderIndex} className="space-y-0.5">
          <div className={`flex items-center gap-2 px-1 ${touch ? 'h-8' : 'h-[26px]'}`}>
            <span className={`animate-pulse rounded-sm bg-ink/10 ${touch ? 'h-[18px] w-[18px]' : 'h-4 w-4'}`} />
            <span className="h-3 w-24 animate-pulse rounded bg-ink/10" />
          </div>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <div
              key={rowIndex}
              className={`flex items-center gap-2 pl-1 pr-2 ${touch ? 'h-8' : 'h-[31px]'}`}
            >
              <span
                className={`shrink-0 animate-pulse rounded-full bg-ink/10 ${
                  touch ? 'h-[18px] w-[18px]' : 'h-4 w-4'
                }`}
              />
              <span
                className="h-3 animate-pulse rounded bg-ink/10"
                style={{ width: `${58 - (rowIndex % 3) * 12}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
