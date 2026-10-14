import type { GitChange } from '@/shared/types/git';
import { UNMERGED_CODES, isUnmergedCode } from '@/shared/lib/fs/git-unmerged';

export interface GitStatusInfo {
  charStatus: string;
  label: string;
  colorClass: string;
  badgeBgClass: string;
  isStaged: boolean;
  /** True for an unmerged porcelain pair — the file has a conflict to resolve. */
  isConflicted?: boolean;
}

export interface FolderGitStatusInfo {
  count: number;
  hasModified: boolean;
  hasUntracked: boolean;
  hasStaged: boolean;
  hasDeleted: boolean;
  /** A conflicted file lives somewhere under this folder. */
  hasConflicted?: boolean;
  colorClass: string;
}

/**
 * Get display info for a single git status code.
 */
export function getGitStatusInfo(status: string, isStaged: boolean = false): GitStatusInfo {
  // Unmerged pairs are answered FIRST and in full: their two letters are the
  // two SIDES of a conflict, not an index/worktree pair, so every rule below
  // reads them wrong — `UU` has no space in either column and therefore
  // reported as staged, and its worktree letter `U` is the same token untracked
  // uses, so it rendered as "Untracked". `isStaged` is deliberately ignored:
  // a conflicted file is neither staged nor unstaged, and the caller's flag is
  // derived from columns that do not mean that here.
  if (isUnmergedCode(status)) {
    return {
      charStatus: '!',
      label: UNMERGED_CODES[status],
      colorClass: 'text-warning',
      badgeBgClass: 'bg-warning/10 text-warning border-warning/25',
      isStaged: false,
      isConflicted: true,
    };
  }

  let charStatus = 'M';
  let label = 'Modified';
  let colorClass = 'text-info';
  let badgeBgClass = 'bg-info/10 text-info border-info/25';

  const raw = (status || '').trim();
  const normalized = raw.toUpperCase();

  if (isStaged) {
    const s = normalized[0] || 'M';
    if (s === 'A') {
      charStatus = 'A';
      label = 'Added (Staged)';
      colorClass = 'text-success';
      badgeBgClass = 'bg-success/10 text-success border-success/25';
    } else if (s === 'D') {
      charStatus = 'D';
      label = 'Deleted (Staged)';
      colorClass = 'text-error';
      badgeBgClass = 'bg-error/10 text-error border-error/25';
    } else if (s === 'R') {
      charStatus = 'R';
      label = 'Renamed (Staged)';
      colorClass = 'text-meta';
      badgeBgClass = 'bg-meta/10 text-meta border-meta/25';
    } else if (s === 'U' || s === '?') {
      charStatus = 'U';
      label = 'Untracked';
      colorClass = 'text-success';
      badgeBgClass = 'bg-success/10 text-success border-success/25';
    } else {
      charStatus = 'M';
      label = 'Modified (Staged)';
      colorClass = 'text-info';
      badgeBgClass = 'bg-info/10 text-info border-info/25';
    }
  } else {
    if (normalized === '??' || normalized === '?' || normalized === 'U' || normalized === 'UNTRACKED') {
      charStatus = 'U';
      label = 'Untracked';
      colorClass = 'text-success';
      badgeBgClass = 'bg-success/10 text-success border-success/25';
    } else {
      const s = normalized[1] || normalized[0] || 'M';
      if (s === 'A') {
        charStatus = 'A';
        label = 'Added';
        colorClass = 'text-success';
        badgeBgClass = 'bg-success/10 text-success border-success/25';
      } else if (s === 'D') {
        charStatus = 'D';
        label = 'Deleted';
        colorClass = 'text-error';
        badgeBgClass = 'bg-error/10 text-error border-error/25';
      } else if (s === 'R') {
        charStatus = 'R';
        label = 'Renamed';
        colorClass = 'text-meta';
        badgeBgClass = 'bg-meta/10 text-meta border-meta/25';
      } else if (s === 'U' || s === '?') {
        charStatus = 'U';
        label = 'Untracked';
        colorClass = 'text-success';
        badgeBgClass = 'bg-success/10 text-success border-success/25';
      } else {
        charStatus = 'M';
        label = 'Modified';
        colorClass = 'text-info';
        badgeBgClass = 'bg-info/10 text-info border-info/25';
      }
    }
  }

  return { charStatus, label, colorClass, badgeBgClass, isStaged };
}

/**
 * Builds lookup maps for files and their ancestor folders.
 */
export function buildGitStatusMaps(changes: GitChange[]): {
  fileMap: Map<string, GitChange>;
  folderMap: Map<string, FolderGitStatusInfo>;
} {
  const fileMap = new Map<string, GitChange>();
  const folderMap = new Map<string, FolderGitStatusInfo>();

  if (!Array.isArray(changes)) {
    return { fileMap, folderMap };
  }

  for (const change of changes) {
    if (!change || !change.file) continue;
    const normalizedFile = change.file.replace(/^\/+/, '');
    fileMap.set(normalizedFile, change);

    // Also index with leading slash or without to ensure reliable lookup
    const segments = normalizedFile.split('/');
    segments.pop(); // remove filename

    let currentPath = '';
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const existing = folderMap.get(currentPath) || {
        count: 0,
        hasModified: false,
        hasUntracked: false,
        hasStaged: false,
        hasDeleted: false,
        colorClass: 'text-info',
      };

      existing.count += 1;
      // A conflicted file is counted as conflicted and NOTHING else: its two
      // porcelain letters are the two sides of a conflict, so the `status[0]`
      // staged test below would mark every one of them staged — the roll-up
      // that paints a collapsed folder's dot.
      if (isUnmergedCode(change.status)) {
        existing.hasConflicted = true;
      } else {
        const isStaged = change.staged || (change.status && change.status[0] !== ' ' && change.status[0] !== '?');
        if (isStaged) existing.hasStaged = true;

        if (change.status === '??') {
          existing.hasUntracked = true;
        } else if (change.status?.includes('D')) {
          existing.hasDeleted = true;
        } else {
          existing.hasModified = true;
        }
      }

      // Priority of folder indicator color: a conflict outranks everything (it
      // is the one state that needs the reader's hand), then Staged / Modified
      // (info/blue), then Untracked (success/green), then Deleted (error/red).
      if (existing.hasConflicted) {
        existing.colorClass = 'text-warning';
      } else if (existing.hasModified || existing.hasStaged) {
        existing.colorClass = 'text-info';
      } else if (existing.hasUntracked) {
        existing.colorClass = 'text-success';
      } else if (existing.hasDeleted) {
        existing.colorClass = 'text-error';
      }

      folderMap.set(currentPath, existing);
    }
  }

  return { fileMap, folderMap };
}
