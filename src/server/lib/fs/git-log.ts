import path from 'path';
import type { GitCommit, GitCommitFile } from '@/shared/types/git';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { SAMPLE_GIT_COMMITS } from '@/client/data/mock/git-commits';
import { isMockMode } from '@/server/mock.server';
import { runShell, shellOk } from '@/server/lib/fs/shell';
import { GIT_ENV, runGit } from '@/server/lib/fs/git-run';

/**
 * Header/body and record separators in the `git log` format below.
 *
 * The body is multi-line and a body line may itself contain a TAB (indented
 * lists, aligned blocks), which the numstat branch below would otherwise read
 * as a changed-file row. So the body is fenced instead of guessed: `\x1f`
 * opens it after the header's last field and `\x1e` closes it — both
 * non-printable, so neither can appear in a commit message.
 */
const HEADER_BODY_SEP = '\x1f';
const COMMIT_RECORD_SEP = '\x1e';

/**
 * The status letters a `--raw` row can carry, folded to the four the file row
 * draws.
 *
 * `C` (a detected copy) is a NEW file and `T` (a type change, file↔symlink) is
 * a modification; anything else git may print (`U` unmerged, `X`) is reported
 * as `M` rather than invented.
 */
const RAW_STATUS_LETTERS: Record<string, string> = { A: 'A', C: 'A', D: 'D', R: 'R' };

/**
 * Read the status letter off one `--raw` row:
 * `:<srcmode> <dstmode> <srcsha> <dstsha> <status>\t<path>` — the rename form
 * carries the old and new path after the same TAB, which is why only the field
 * before it is read.
 *
 * This is the ONLY trustworthy source of a file's state. `--numstat` reports
 * additions and deletions and nothing else, so a modified file that only lost
 * lines (`0\t3\tf.txt`) is indistinguishable from a deletion by its counts —
 * which is how an `M` came to render as a `D`.
 */
function parseRawStatus(line: string): string | null {
  if (!line.startsWith(':')) return null;
  const tab = line.indexOf('\t');
  if (tab < 0) return null;
  const meta = line.slice(0, tab).split(' ');
  const code = meta[meta.length - 1] || '';
  const letter = code.charAt(0).toUpperCase();
  if (!letter) return null;
  return RAW_STATUS_LETTERS[letter] ?? 'M';
}

/**
 * Context lines requested by "Expand all context".
 *
 * `git show`'s default is three, which is the whole patch a commit row can
 * reveal — so the button had nothing to expand. `-U` takes any count, so this
 * is a cap on the FILE, not on the change.
 */
const FULL_DIFF_CONTEXT = 1000000;

export function parseGitLogOutput(stdout: string): GitCommit[] {
  const commits: GitCommit[] = [];
  const lines = stdout.split('\n');
  let currentCommit: GitCommit | null = null;
  let bodyLines: string[] = [];
  let inBody = false;
  // `--raw` and `--numstat` are emitted as two blocks per commit — one row per
  // file in each, in the same order — so they are collected separately and
  // zipped when the commit flushes. The status letter comes from git itself;
  // only the counts and the rendered path come from numstat.
  let rawStatuses: string[] = [];
  let numstatRows: GitCommitFile[] = [];

  const flush = () => {
    if (!currentCommit) return;
    // `%b` ends with the newline that separates it from the next field, so the
    // trailing blank lines are the format's, not the author's. A one-line
    // commit keeps no `body` at all rather than an empty string, which is what
    // the row's expand affordance keys off.
    const body = bodyLines.join('\n').trimEnd();
    if (body) currentCommit.body = body;
    currentCommit.files = numstatRows.map((row, i) => ({
      ...row,
      status: rawStatuses[i] ?? row.status,
    }));
    commits.push(currentCommit);
  };

  for (const line of lines) {
    if (line.startsWith('COMMIT_SPLIT|~|')) {
      flush();
      const sepIdx = line.indexOf(HEADER_BODY_SEP);
      const header = sepIdx >= 0 ? line.slice(0, sepIdx) : line;
      const rest = sepIdx >= 0 ? line.slice(sepIdx + 1) : '';
      const parts = header.split('|~|');
      const hash = parts[1] || '';
      const shortHash = parts[2] || hash.slice(0, 8);
      const author = parts[3] || 'Unknown';
      const date = parts[4] || '';
      const message = parts[5] || '';
      const refStr = parts[6] || '';
      const parentStr = parts[7] || '';

      const refs = refStr
        ? refStr
            .split(',')
            .map(r => r.trim())
            .filter(Boolean)
        : [];
      const parents = parentStr
        ? parentStr
            .split(/\s+/)
            .map(p => p.trim())
            .filter(Boolean)
        : [];

      currentCommit = {
        hash,
        shortHash,
        author,
        date,
        message,
        refs,
        parents,
        files: [],
      };
      rawStatuses = [];
      numstatRows = [];
      // The header's last field is followed by the separator, so the body
      // begins on this same line (`%b`'s first line) and continues on the next
      // ones. A commit with no body still emits the record separator here, so
      // the terminator is looked for on this line too — otherwise the first
      // numstat row would be read as body text.
      const bodyEnd = rest.indexOf(COMMIT_RECORD_SEP);
      if (bodyEnd >= 0) {
        bodyLines = rest.slice(0, bodyEnd) ? [rest.slice(0, bodyEnd)] : [];
        inBody = false;
      } else {
        bodyLines = rest ? [rest] : [];
        inBody = sepIdx >= 0;
      }
    } else if (inBody) {
      const end = line.indexOf(COMMIT_RECORD_SEP);
      if (end >= 0) {
        bodyLines.push(line.slice(0, end));
        inBody = false;
      } else {
        bodyLines.push(line);
      }
    } else if (currentCommit && line.startsWith(':')) {
      // A `--raw` row. Read BEFORE the numstat branch: a raw RENAME row also
      // holds three TAB-separated fields (the status, the old path, the new
      // one), so it would otherwise be read as a numstat row.
      const status = parseRawStatus(line);
      if (status) rawStatuses.push(status);
    } else if (currentCommit && line.trim()) {
      const parts = line.split('\t');
      if (parts.length >= 3) {
        const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
        const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
        let file = parts[2].trim();
        if (file.startsWith('"') && file.endsWith('"')) {
          try { file = JSON.parse(file); } catch {}
        }
        numstatRows.push({ file, status: 'M', additions, deletions });
      }
    }
  }

  flush();

  // An empty stdout is a real answer — `--skip` past the end of history, or a
  // branch with no commits — so it parses to no rows. This used to return
  // SAMPLE_GIT_COMMITS, which put 20 commits from a different repository at the
  // bottom of every history and in every graph, in real mode too.
  return commits;
}

export interface FetchCommitsResult {
  commits: GitCommit[];
  hasMore: boolean;
  total?: number;
}

export async function fetchGitCommits(
  targetDir: string,
  limit: number = COMMIT_PAGE_SIZE,
  skip: number = 0
): Promise<FetchCommitsResult> {
  try {
    let total = 0;
    try {
      const countOut = await runShell('git rev-list --count HEAD', { cwd: targetDir, timeout: 5000, env: GIT_ENV });
      if (shellOk(countOut)) total = parseInt(countOut.stdout.trim(), 10) || 0;
    } catch {
      total = 0;
    }

    const result = await runShell(
      `git log -n ${limit} --skip=${skip} --raw --numstat --date-order --pretty=format:"COMMIT_SPLIT|~|%H|~|%h|~|%an|~|%ad|~|%s|~|%D|~|%p%x1f%b%x1e" --date=format:"%b %d, %Y, %I:%M %p"`,
      { cwd: targetDir, timeout: 15000 }
    );

    // A branch with no commits makes `git log` exit non-zero with "does not
    // have any commits yet" — an empty history, not a failure. Reading it as a
    // failure is what let the mock fallback below answer for a real repository.
    if (!shellOk(result)) {
      if (total === 0 && (await hasNoCommits(targetDir))) return { commits: [], hasMore: false, total: 0 };
      throw new Error(result.stderr || 'git log failed');
    }

    const commits = parseGitLogOutput(result.stdout);
    const hasMore = total > 0 ? skip + commits.length < total : commits.length === limit;
    return { commits, hasMore, total };
  } catch {
    // Reached only when git could not answer at all (not a repository, a bad
    // revision, a timeout). Mock rows are reserved for MOCK mode, where the
    // whole chamber runs on presets — returning them here showed 20 commits
    // from an unrelated repository in real mode.
    if (isMockMode()) {
      const paged = SAMPLE_GIT_COMMITS.slice(skip, skip + limit);
      return {
        commits: paged,
        hasMore: skip + paged.length < SAMPLE_GIT_COMMITS.length,
        total: SAMPLE_GIT_COMMITS.length,
      };
    }
    return { commits: [], hasMore: false, total: 0 };
  }
}

/** True when `HEAD` resolves to nothing — a repository with no commits yet. */
async function hasNoCommits(targetDir: string): Promise<boolean> {
  const out = await runShell('git rev-parse --verify HEAD', { cwd: targetDir, timeout: 5000, env: GIT_ENV });
  return !shellOk(out);
}

/**
 * The message of the commit `--amend` would rewrite — the draft the panel
 * pre-fills when the user ticks Amend.
 *
 * Read ON DEMAND, never off the status payload: that read is republished on
 * every tool call, and this is one `git log` per tick of a checkbox.
 *
 * `%B` is the raw body, so a multi-line message (and a merge commit's own
 * message) round-trips intact — the amend replaces the whole message, so
 * seeding only the subject would silently drop the body it replaced.
 *
 * `null` in a repository whose HEAD is unborn (`git log` exits 128 there):
 * there is nothing to amend, so there is nothing to pre-fill. The panel leaves
 * the draft alone rather than seeding an empty message.
 */
export async function readHeadCommitMessage(targetDir: string): Promise<string | null> {
  const result = await runGit(['log', '-1', '--pretty=format:%B'], {
    cwd: targetDir,
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
  if (result.exitCode !== 0 || result.error) return null;
  // Trailing whitespace only: git terminates `%B` with a newline, and leading
  // indentation inside the message is the author's.
  const message = result.stdout.replace(/\s+$/, '');
  return message.length > 0 ? message : null;
}

/**
 * The patch for one file in one commit.
 *
 * `fullContext` asks git for the whole file around the change (`-U<large>`),
 * which is what the modal's "Expand all context" needs: `git show`'s default is
 * three lines of context, so the button's promise is unreachable from the
 * default patch — there is simply no more context in the payload to reveal.
 */
export async function fetchFileDiff(
  targetDir: string,
  hash: string,
  file: string,
  fullContext: boolean = false,
): Promise<string> {
  let cleanFile = file.replace(/^\.\//, '').trim();
  const ctx = fullContext ? ` -U${FULL_DIFF_CONTEXT}` : '';

  // If the file in numstat was a rename (e.g. "path/{old.ts => new.ts}" or "old.ts => new.ts")
  if (cleanFile.includes(' => ')) {
    if (cleanFile.includes('{') && cleanFile.includes('}')) {
      cleanFile = cleanFile.replace(/\{.*? => (.*?)\}/, '$1');
    } else {
      cleanFile = cleanFile.split(' => ')[1].trim();
    }
  }

  // 1. Try standard git show with pretty format patch
  const showPatch = await runShell(`git show --pretty=format:"" --patch${ctx} "${hash}" -- "${cleanFile}"`, { cwd: targetDir, timeout: 10000, env: GIT_ENV });
  if (showPatch.stdout.trim()) return showPatch.stdout.trim();

  // 2. Try git diff-tree with root support
  const diffTree = await runShell(`git diff-tree -r -p --root${ctx} "${hash}" -- "${cleanFile}"`, { cwd: targetDir, timeout: 10000, env: GIT_ENV });
  if (diffTree.stdout.trim()) return diffTree.stdout.trim();

  // 3. If it is an added file or root commit, show file content directly from git blob
  const showBlob = await runShell(`git show "${hash}:${cleanFile}"`, { cwd: targetDir, timeout: 10000, env: GIT_ENV });
  if (showBlob.stdout.length > 0) {
    const lines = showBlob.stdout.split('\n');
    const diffLines = lines.map((l) => `+${l}`).join('\n');
    return `@@ -0,0 +1,${lines.length} @@\n${diffLines}`;
  }

  // 4. Try previous parent blob for deleted file
  const showParent = await runShell(`git show "${hash}^:${cleanFile}"`, { cwd: targetDir, timeout: 10000, env: GIT_ENV });
  if (showParent.stdout.length > 0) {
    const lines = showParent.stdout.split('\n');
    const diffLines = lines.map((l) => `-${l}`).join('\n');
    return `@@ -1,${lines.length} +0,0 @@\n${diffLines}`;
  }

  // 5. Try reading directly from target filesystem if available
  try {
    const diskFile = Bun.file(path.join(targetDir, cleanFile));
    if ((await diskFile.exists()) && !(await diskFile.stat()).isDirectory()) {
      const content = await diskFile.text();
      const lines = content.split('\n');
      const diffLines = lines.map((l) => `+${l}`).join('\n');
      return `@@ -0,0 +1,${lines.length} @@\n${diffLines}`;
    }
  } catch {}

  // 6. Fall back to mock sample data if exists
  const sample = SAMPLE_GIT_COMMITS.find(c => c.hash === hash || c.shortHash === hash || hash.startsWith(c.shortHash));
  const sampleFile = sample?.files?.find(f => f.file === file || f.file === cleanFile);
  if (sampleFile?.diff) return sampleFile.diff;

  // 7. Generate readable sample diff
  return `@@ -0,0 +1,6 @@\n+// File: ${cleanFile}\n+// Commit: ${hash.slice(0, 8)}\n+// Changes recorded for this commit\n+export const status = "synced";\n+console.log("Commit updated: ${cleanFile}");`;
}
