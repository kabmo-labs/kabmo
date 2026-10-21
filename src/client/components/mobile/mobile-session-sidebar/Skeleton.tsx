/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Mobile placeholder for the session list while the first
 * `/api/sessions/list` fetch is in flight. Mirrors the desktop skeleton's
 * spacing at the mobile list's padding scale.
 */

const PLACEHOLDER_FOLDERS = [3, 2];

export function MobileSessionListSkeleton() {
  return (
    <div className="flex-1 p-3 space-y-4" aria-hidden="true">
      {PLACEHOLDER_FOLDERS.map((rows, folderIndex) => (
        <div key={folderIndex} className="space-y-2">
          <div className="flex items-center gap-2 py-2">
            <span className="w-4 h-4 rounded-sm animate-pulse bg-ink/10" />
            <span className="h-3 w-24 rounded animate-pulse bg-ink/10" />
          </div>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <div key={rowIndex} className="flex items-center gap-2 rounded py-2">
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
