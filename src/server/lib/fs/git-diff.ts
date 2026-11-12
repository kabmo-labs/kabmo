import path from 'path';
import type { FileDiffData } from '@/shared/types/git';
import { runGit } from '@/server/lib/fs/git-run';

/**
 * Context lines requested when the reader wants the whole file rather than the
 * hunks. `--unified` takes any count, so this is a cap on the FILE, not on the
 * change: git emits every line it can reach around the edits.
 */
const FULL_CONTEXT = 1000000;

/**
 * Run one git probe and return its stdout ('' on failure).
 *
 * Every operand is its own argv element, never interpolated into a shell
 * string. A repo-relative path is repository-controlled data: a file named
 * ``a$(touch /tmp/PWNED).sh`` used to have that substitution EXECUTED by the
 * `sh -c` the previous form went through — verified, the file appeared — and a
 * filename holding a double quote broke the quoting outright. The `:0:` and
 * `HEAD:` spellings are a single argv element for the same reason.
 */
async function gitOut(args: string[], cwd: string, timeout: number, maxBuffer: number = 1024 * 1024 * 2): Promise<string> {
  const result = await runGit(args, { cwd, timeout, maxBuffer });
  return result.error === undefined && result.exitCode === 0 ? result.stdout : '';
}

/**
 * One `git show <rev>` read, or `null` when the rev does not resolve.
 *
 * Distinct from `gitOut` because `''` is a real answer here: a file that is
 * empty in the index or at HEAD must not be confused with a path that is
 * absent from that tree — the pair below is chosen from which side exists.
 */
async function gitShow(rev: string, cwd: string): Promise<string | null> {
  const result = await runGit(['show', rev], { cwd, timeout: 5000 });
  return result.error === undefined && result.exitCode === 0 ? result.stdout : null;
}

/**
 * Fetch git diff for a specific file in the working directory or index.
 *
 * `fullContext` asks git for the entire file rather than the surrounding hunks,
 * which is what the panel's "Full Code" mode renders — the diff comes back in
 * the same unified format, so no second rendering path exists.
 */
export async function fetchWorkingFileDiff(
  targetDir: string,
  file: string,
  staged: boolean = false,
  requestedStatus?: string,
  fullContext: boolean = false
): Promise<FileDiffData> {
  // Only a LEADING `./`, `../` or `/` is removed. The previous `[./\\]+` class
  // also ate a leading dot that began a real name, so `.claude/tools/x.sh`
  // became `claude/tools/x.sh` — a path that does not exist, which every probe
  // below then answered "No differences found" for. Measured on the author's
  // checkouts: 292 of 403 changed files, and they were exactly the dot-paths
  // (`.github/`, `.idea/`, `.claude/`, `.history/`, `.env`, `.gitignore`,
  // `.DS_Store`) — which is what "the diff does not show for some .sh/.xml" was.
  //
  // A backslash folds to a separator on WINDOWS ONLY. There it cannot be part
  // of a name, and a client-supplied path may spell the separator either way;
  // on POSIX it is an ordinary filename character (`a\b.sh` is a legal name),
  // so folding it there pointed the probes at a file that does not exist.
  const cleanFile = (process.platform === 'win32' ? file.replace(/\\/g, '/') : file)
    .replace(/^(?:\.\.?\/|\/)+/, '');
  const fullPath = path.join(targetDir, cleanFile);
  let status = requestedStatus && requestedStatus.trim() ? requestedStatus.trim() : 'M';
  let diff = '';
  let oldContent = '';
  let newContent = '';
  let additions = 0;
  let deletions = 0;

  try {
    // Check porcelain status of this file
    const statusResult = await gitOut(['status', '--porcelain=v1', '--', cleanFile], targetDir, 10000);
    const statusLine = statusResult.trim();
    if (statusLine) {
      status = statusLine.slice(0, 2).trim() || status;
    }

    // The two SIDES depend on which view was asked for, and reading them off
    // the wrong trees is what made a file's staged and unstaged views
    // identical: a staged read compares HEAD with the index, an unstaged read
    // compares the index with the working file. Reading HEAD vs the working
    // file for both is a different diff from either.
    const headContent = await gitShow(`HEAD:${cleanFile}`, targetDir);
    const indexContent = await gitShow(`:0:${cleanFile}`, targetDir);
    let workingContent = '';
    try {
      workingContent = await Bun.file(fullPath).text();
    } catch {
      workingContent = '';
    }
    if (staged) {
      oldContent = headContent ?? '';
      // `null` means the path is not in the index. For a staged deletion that
      // is the empty side of the pair, not a reason to fall back to the file;
      // an untracked path has no index entry either, and its "would be added"
      // side is the file on disk.
      newContent = indexContent ?? (status === '??' ? workingContent : '');
    } else {
      // An untracked or unmerged path has no stage-0 entry; its "before" side is
      // HEAD for the unmerged case and empty otherwise. A path deleted from the
      // index (`git rm --cached`) is the exception: its index side is empty, so
      // HEAD would claim a change the working tree does not have.
      oldContent = indexContent ?? (status.startsWith('D') ? '' : headContent ?? '');
      newContent = workingContent;
    }

    // `-U<n>` on every probe: the full-code mode asks for the whole file, and
    // the diff-only mode keeps git's own default by passing no flag at all.
    const ctx = fullContext ? [`-U${FULL_CONTEXT}`] : [];
    // Full-context output is the file, not the change, so a fixed buffer would
    // truncate a large file's diff — and a killed process is not a success, so
    // `gitOut` reports it as no diff at all and the synthesized whole-file
    // rewrite below takes over silently. Sized off the content already read, so
    // it cannot exceed roughly twice the file.
    const buf = fullContext
      ? Math.max(1024 * 1024 * 16, (oldContent.length + newContent.length) * 2 + 1024 * 1024)
      : 1024 * 1024 * 2;

    // No fallbacks between the two views. `git diff --cached` is the staged
    // view and `git diff` is the unstaged one; substituting the other when the
    // asked-for diff is empty is how a file listed under "Changes" showed its
    // staged patch.
    if (staged) {
      diff = await gitOut(['diff', ...ctx, '--cached', '--', cleanFile], targetDir, 10000, buf);
    } else if (status === '??' || status === 'U' || status === '?') {
      // Untracked file: `--no-index` exits 1 when it produced a diff, so read
      // stdout directly instead of relying on the exit code.
      const untracked = await runGit(['diff', ...ctx, '--no-index', '/dev/null', cleanFile], { cwd: targetDir, timeout: 10000, maxBuffer: buf });
      diff = untracked.stdout.trim() ? untracked.stdout : '';
    } else {
      diff = await gitOut(['diff', ...ctx, '--', cleanFile], targetDir, 10000, buf);
    }

    // 4. If git diff is still empty but new content exists:
    if (!diff.trim()) {
      if (oldContent && newContent && oldContent !== newContent) {
        // Synthesize diff from old and new lines
        const oldLines = oldContent.split(/\r?\n/);
        const newLines = newContent.split(/\r?\n/);
        const diffBody = [
          ...oldLines.map((l) => `-${l}`),
          ...newLines.map((l) => `+${l}`),
        ].join('\n');
        diff = `--- a/${cleanFile}\n+++ b/${cleanFile}\n@@ -1,${oldLines.length} +1,${newLines.length} @@\n${diffBody}`;
      } else if (newContent) {
        const lines = newContent.split(/\r?\n/);
        const prefix = status === 'A' || status === '??' ? '+' : ' ';
        const diffBody = lines.map((l) => `${prefix}${l}`).join('\n');
        diff = `--- a/${cleanFile}\n+++ b/${cleanFile}\n@@ -1,${lines.length} +1,${lines.length} @@\n${diffBody}`;
      }
    }

    // Count additions and deletions from diff
    if (diff) {
      const diffLines = diff.split('\n');
      for (const line of diffLines) {
        if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) continue;
        if (line.startsWith('+')) additions++;
        else if (line.startsWith('-')) deletions++;
      }
    }

    return {
      file: cleanFile,
      diff: diff || (newContent ? `--- a/${cleanFile}\n+++ b/${cleanFile}\n@@ -1,1 +1,1 @@\n ${newContent.slice(0, 100)}` : 'No differences found'),
      oldContent,
      newContent,
      staged,
      status,
      additions,
      deletions,
    };
  } catch (error: any) {
    return {
      file: cleanFile,
      diff: `// Unable to compute diff for ${cleanFile}: ${error?.message || 'Unknown error'}`,
      oldContent: '',
      newContent,
      staged,
      status: 'M',
      additions: 0,
      deletions: 0,
    };
  }
}
