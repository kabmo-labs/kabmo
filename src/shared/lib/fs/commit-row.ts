import type { GitCommit, GitCommitFile } from '@kabmo-labs/kabmo-app-contracts/git';

/**
 * Normalizes the changed-file rows a commit carries.
 *
 * Counts are coerced to numbers because `git log --numstat` prints `-` for a
 * binary file, which the parser already maps to 0 — but a row that arrives from
 * a cached payload may still carry the raw string, and `'12'` renders as a
 * number while `'a'` would print `NaA`.
 */
function normalizeCommitFiles(raw: unknown): GitCommitFile[] {
  if (!Array.isArray(raw)) return [];
  const files: GitCommitFile[] = [];

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const f = row as Record<string, unknown>;
    if (typeof f.file !== 'string' || !f.file) continue;
    files.push({
      file: f.file,
      status: typeof f.status === 'string' ? f.status : 'M',
      additions: typeof f.additions === 'number' && Number.isFinite(f.additions) ? f.additions : 0,
      deletions: typeof f.deletions === 'number' && Number.isFinite(f.deletions) ? f.deletions : 0,
      diff: typeof f.diff === 'string' ? f.diff : undefined,
    });
  }

  return files;
}

/**
 * Normalizes the commit rows a git response carries into `GitCommit`.
 *
 * The rows cross a JSON boundary, so every field is checked rather than
 * asserted: a row without a hash is dropped instead of becoming `'unknown'`,
 * because an identity-less row cannot be selected, matched to its parent, or
 * deduplicated against the next page — it would silently duplicate on every
 * `load more`.
 */
export function normalizeCommits(raw: unknown): GitCommit[] {
  if (!Array.isArray(raw)) return [];
  const commits: GitCommit[] = [];

  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const c = row as Record<string, unknown>;
    const hash = typeof c.hash === 'string' && c.hash ? c.hash : '';
    if (!hash) continue;

    commits.push({
      hash,
      shortHash: typeof c.shortHash === 'string' && c.shortHash ? c.shortHash : hash.slice(0, 8),
      author: typeof c.author === 'string' ? c.author : 'Unknown',
      date: typeof c.date === 'string' ? c.date : typeof c.time === 'string' ? c.time : '',
      message: typeof c.message === 'string' ? c.message : '',
      body: typeof c.body === 'string' ? c.body : undefined,
      parents: Array.isArray(c.parents) ? c.parents.filter((p): p is string => typeof p === 'string') : [],
      refs: Array.isArray(c.refs) ? c.refs.filter((r): r is string => typeof r === 'string') : [],
      files: normalizeCommitFiles(c.files),
      lane: typeof c.lane === 'number' ? c.lane : undefined,
    });
  }

  return commits;
}
