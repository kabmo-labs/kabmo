/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Placeholder for the session list while the first `/api/sessions/list`
 * fetch is in flight. Pure chrome — two workspace blocks with a few session
 * rows each, matching the real list's spacing so the swap-in is stable.
 */

const PLACEHOLDER_FOLDERS = [3, 2];

export function SessionListSkeleton() {
  return (
    <div className="flex-1 p-2 space-y-4" aria-hidden="true">
      {PLACEHOLDER_FOLDERS.map((rows, folderIndex) => (
        <div key={folderIndex} className="space-y-1.5">
          <div className="flex items-center gap-2 px-1 py-1.5">
            <span className="w-3.5 h-3.5 rounded-sm animate-pulse bg-ink/10" />
            <span className="h-3 w-24 rounded animate-pulse bg-ink/10" />
          </div>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <div key={rowIndex} className="flex items-center gap-2 rounded px-2 py-1.5">
              <span className="w-4 h-4 rounded-full animate-pulse bg-ink/10" />
              <span
                className="h-3 rounded animate-pulse bg-ink/10"
                style={{ width: `${58 - (rowIndex % 3) * 12}%` }}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
