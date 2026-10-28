/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `git status --porcelain=v2 --branch -z` — the ONE spawn that answers every
 * fact a repository row shows: the branch, whether HEAD is detached, the
 * upstream and its ahead/behind track, and the counts of changed, untracked and
 * conflicted paths.
 *
 * **v2, not the v1 the panel's own read uses, because v1 has no structured
 * header.** v1 prints `## main...origin/main [ahead 1, behind 2]` and everything
 * about the upstream has to be re-derived from that prose — including its two
 * degenerate spellings, `## No commits yet on main` and `## HEAD (no branch)`.
 * v2 states each fact on its own `#` line, and `--branch` is what adds them.
 *
 * The forms were measured against real repositories:
 *
 * ```
 * # branch.oid f709e10eb56661c42bcc0b2871221817bb733862   (initial) when unborn
 * # branch.head main                                      (detached) when detached
 * # branch.upstream origin/main                            absent with no upstream
 * # branch.ab +0 -0                                       absent when the upstream is GONE
 * ```
 *
 * `branch.ab` absent with `branch.upstream` PRESENT is the `[gone]` case — the
 * remote ref was deleted, which is what a remote rename without `--prune`
 * leaves behind. It is not "in sync", and the row must not say it is.
 *
 * `-z` for the same reason `parsePorcelainZ` uses it: the non-`-z` form quotes
 * any path holding a space or a non-ASCII byte and octal-escapes the latter, and
 * no decode reverses that.
 */

/** One repository's status, as a `--porcelain=v2 --branch` read reports it. */
export interface PorcelainV2Summary {
  /** The checked-out branch, or the short sha when HEAD is detached. */
  branch: string;
  detached: boolean;
  /** False on a branch with no commits yet — the log read is skipped then. */
  hasCommits: boolean;
  /** The upstream's short name (`origin/main`), or `''`. */
  upstream: string;
  /** Commits ahead of the upstream; 0 when there is no track to read. */
  ahead: number;
  /** Commits behind the upstream; 0 when there is no track to read. */
  behind: number;
  /** The upstream ref no longer exists on the remote. */
  gone: boolean;
  /** Modified / staged / renamed / unmerged paths. */
  changed: number;
  /** Paths git has never seen. */
  untracked: number;
  /** Unmerged index entries — a conflict waiting for a resolve. */
  conflicts: number;
}

/**
 * Parse the `-z` form.
 *
 * Records are NUL-terminated and a rename or copy spends TWO of them — the new
 * path, then the original — so the second is consumed rather than read as a
 * record of its own (the same unwrapping `parsePorcelainZ` performs).
 *
 * A record's fixed fields are space-separated and the path is whatever follows
 * them, so each type's path is the remaining tokens rejoined with a single
 * space: splitting and rejoining a verbatim path is lossless, and it keeps this
 * parser from depending on a field count git is free to extend.
 */
export function parsePorcelainV2(out: string): PorcelainV2Summary {
  const summary: PorcelainV2Summary = {
    branch: '',
    detached: false,
    hasCommits: true,
    upstream: '',
    ahead: 0,
    behind: 0,
    gone: false,
    changed: 0,
    untracked: 0,
    conflicts: 0,
  };
  let oid = '';
  let sawAb = false;

  const records = out.split('\0');
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;

    if (record.startsWith('# ')) {
      const [key, ...rest] = record.slice(2).split(' ');
      const value = rest.join(' ');
      if (key === 'branch.oid') oid = value;
      else if (key === 'branch.head') {
        if (value === '(detached)') summary.detached = true;
        else summary.branch = value;
      } else if (key === 'branch.upstream') summary.upstream = value;
      else if (key === 'branch.ab') {
        sawAb = true;
        const ahead = /\+(\d+)/.exec(value);
        const behind = /-(\d+)/.exec(value);
        summary.ahead = ahead ? Number(ahead[1]) : 0;
        summary.behind = behind ? Number(behind[1]) : 0;
      }
      continue;
    }

    const kind = record[0];
    if (kind === '1') {
      summary.changed += 1;
      continue;
    }
    if (kind === '2') {
      summary.changed += 1;
      // The original path is its own record; it names nothing the tree has.
      i += 1;
      continue;
    }
    if (kind === 'u') {
      // An unmerged entry is a CONFLICT, not a change: its two letters are the
      // two SIDES of the conflict, and counting it as an ordinary change is what
      // made the panel report every conflicted file as staged.
      summary.conflicts += 1;
      continue;
    }
    if (kind === '?') {
      summary.untracked += 1;
      continue;
    }
    // `!` (ignored) is never requested, and anything else is a shape this
    // version of git does not emit — counted nowhere rather than guessed at.
  }

  if (summary.detached) summary.branch = oid.slice(0, 7);
  summary.hasCommits = oid !== '' && oid !== '(initial)';
  summary.gone = summary.upstream !== '' && !sawAb;
  return summary;
}
