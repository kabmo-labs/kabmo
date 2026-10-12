/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `GET /api/fs/git` — the Source Control panel's data, and the file-diff /
 * commit-history endpoints the diff panel and commit modal read.
 *
 * Repository discovery (`?reposOnly=1`) is a background walk over the scoped
 * root; see `lib/fs/git-repos.ts`. This module owns the request shapes.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import path from 'path';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { resolveRoot } from '@/server/lib/fs/root';
import { discoveredRepos, rescanRepos, startRepoScan } from '@/server/lib/fs/git-repos';
import { fetchFileDiff, fetchGitCommits } from '@/server/lib/fs/git-log';
import { fetchWorkingFileDiff } from '@/server/lib/fs/git-diff';
import { invalidateRemoteRefs, markRemoteRefsFresh } from '@/server/lib/fs/git-sync';
import { pullBranch, pushBranch } from '@/server/lib/fs/git-publish';
import { repoRelative, resolveRepoPath, runGit, type GitRunResult } from '@/server/lib/fs/git-run';
import { readGitStatus } from '@/server/lib/fs/git-status-read';
import { emitRealtimeSignal } from '@/server/lib/realtime/signals.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const rootDir = await resolveRoot(url.searchParams.get('root'), process.cwd());

  // Kick off nested-repo discovery in the background (non-blocking) and read
  // whatever is already cached. `rescan=1` invalidates the cache so a fresh
  // discovery pass starts (used by the repo-switcher refresh button).
  const rescan = url.searchParams.get('rescan') === '1';
  if (rescan) rescanRepos(rootDir);
  else startRepoScan(rootDir);
  const { repos, pending } = discoveredRepos(rootDir);

  // Lightweight polling endpoint: just the discovered repos, no git status.
  if (url.searchParams.get('reposOnly') === '1') {
    return json({ repos, reposPending: pending, activeRepo: (url.searchParams.get('repo') || '.') });
  }

  // An explicitly requested repo is honored even while a rescan is pending
  // (path containment is enforced below), so refreshing the list doesn't yank
  // the user back to the root repo mid-scan.
  let repo = url.searchParams.get('repo') || '';
  if (!repo) {
    repo = repos.includes('.') ? '.' : (repos[0] || '.');
  }

  const targetDir = repo === '.' ? rootDir : path.join(rootDir, repo);
  if (targetDir !== rootDir && !targetDir.startsWith(rootDir + path.sep)) {
    return json({ error: 'Invalid repo path' }, { status: 403 });
  }

  // File diff endpoint
  if (url.searchParams.get('fileDiff') === '1' || url.searchParams.get('diff') === '1') {
    const targetFile = url.searchParams.get('file');
    if (targetFile) {
      const staged = url.searchParams.get('staged') === '1' || url.searchParams.get('staged') === 'true';
      const statusParam = url.searchParams.get('status') || undefined;
      const fullContext = url.searchParams.get('fullContext') === '1';
      const diffData = await fetchWorkingFileDiff(targetDir, targetFile, staged, statusParam, fullContext);
      return json({ success: true, ...diffData });
    }
  }

  // Commits history / graph endpoint
  if (url.searchParams.get('commits') === '1' || url.searchParams.get('history') === '1' || url.searchParams.get('graph') === '1') {
    const limit = parseInt(url.searchParams.get('limit') || String(COMMIT_PAGE_SIZE), 10);
    const skip = parseInt(url.searchParams.get('skip') || '0', 10);
    const result = await fetchGitCommits(targetDir, limit, skip);
    return json({
      success: true,
      data: result.commits,
      hasMore: result.hasMore,
      total: result.total,
      limit,
      skip,
    });
  }

  // Ahead/behind are only requested by the git panel (`?sync=1`); the
  // status-only reads (activity bar, file explorer) must not trigger a network
  // fetch, and must not pay for a count they never read.
  //
  // The read itself lives in `lib/fs/git-status-read.ts`, so the realtime `git:`
  // topic and this route answer from one implementation.
  const status = await readGitStatus(targetDir, {
    count: url.searchParams.get('sync') === '1' ? 'fetch' : undefined,
  });

  // No `repos`/`reposPending`/`activeRepo` here: the repo list travels on the
  // `?reposOnly=1` branch, keyed to the root it was discovered for. Echoing a
  // repo back in a status response is what let a panel adopt a repo it had
  // never chosen — and adopt it under whichever workspace was active when the
  // echo arrived.
  return json(status);
}

export async function action({ request }: ActionFunctionArgs) {
  const formData = await request.formData();
  const rootDir = await resolveRoot(formData.get('root') as string, process.cwd());
  const repo = (formData.get('repo') as string) || '.';
  const targetDir = repo === '.' ? rootDir : path.join(rootDir, repo);
  if (targetDir !== rootDir && !targetDir.startsWith(rootDir + path.sep)) {
    return json({ error: 'Invalid repo path' }, { status: 403 });
  }
  const actionType = formData.get('actionType') as string;

  try {
    if (actionType === 'commit') {
      const message = (formData.get('message') as string) ?? '';
      // argv, never `git commit -m "<message>"`: a message holding a backtick
      // or a `$( )` was executed by the shell the old command string went
      // through (measured: ``fix `touch /tmp/PWN` thing`` created the file).
      await expectOk(['commit', '-m', message], targetDir);
    } else if (actionType === 'stage') {
      const file = fileForAction(formData, targetDir);
      await expectOk(['add', '--', file], targetDir);
    } else if (actionType === 'stage_all') {
      await expectOk(['add', '-A'], targetDir);
    } else if (actionType === 'unstage') {
      const file = fileForAction(formData, targetDir);
      // `git reset`, not `git restore --staged`: the latter resolves HEAD and
      // fails outright in a repository that has no commits yet ("could not
      // resolve 'HEAD'"), which is exactly where a first commit is staged.
      // `reset` also accepts pathspecs in a `git reset -- <path>`; the path
      // comes from the same guard the other actions use.
      await expectOk(['reset', '-q', '--', file], targetDir);
    } else if (actionType === 'unstage_all') {
      await expectOk(['reset', '-q'], targetDir);
    } else if (actionType === 'revert') {
      const file = fileForAction(formData, targetDir);
      await revertPath(targetDir, file);
    } else if (actionType === 'revert_all') {
      // `checkout` covers tracked changes in a repository with no commits too,
      // and it never deletes an untracked file — `clean` does that explicitly.
      await expectOk(['checkout', '--', '.'], targetDir);
      await expectOk(['clean', '-fd'], targetDir);
    } else if (actionType === 'checkout') {
      const branch = formData.get('branch') as string;
      const localName = branch.split('/').slice(1).join('/');
      // Order matters, and `git rev-parse --verify <x>^{commit}` is NOT a
      // discriminator: it resolves for a remote-tracking ref too, so it matched
      // `origin/feature` and detached instead of creating the local branch
      // (verified). A commit is what the commit modal's "checkout" names, and it
      // sends the full `%H`, so the SHAPE is what identifies it.
      if (await refExists(`refs/heads/${branch}`, targetDir)) {
        await expectOk(['checkout', branch], targetDir);
      } else if (localName && (await refExists(`refs/heads/${localName}`, targetDir))) {
        await expectOk(['checkout', localName], targetDir);
      } else if (/^[0-9a-f]{7,40}$/i.test(branch) && (await refExists(`${branch}^{commit}`, targetDir))) {
        // A detached checkout is what the request means: `-b <name> --track
        // <sha>` refuses with "starting point '<sha>' is not a branch".
        await expectOk(['checkout', '--detach', branch], targetDir);
      } else {
        // A remote-tracking ref (or a name git rejects with its own message):
        // create the local branch and track it.
        await expectOk(['checkout', '-b', localName, '--track', branch], targetDir);
      }
      // The counts are per-branch: the refs the previous branch refreshed say
      // nothing about the new one's upstream.
      invalidateRemoteRefs(targetDir);
    } else if (actionType === 'create_branch') {
      const branch = formData.get('branch') as string;
      // The toolbar's "Create new branch" flow: create AND switch, which is
      // what a user who just named a branch expects to be on.
      await expectOk(['checkout', '-b', branch], targetDir);
      invalidateRemoteRefs(targetDir);
    } else if (actionType === 'create_branch_at') {
      const branch = formData.get('branch') as string;
      const startPoint = (formData.get('hash') as string) || '';
      // The commit modal's "create branch here": create the ref at that commit
      // and STAY PUT. `git checkout -b <name> <sha>` was both the wrong verb and
      // a failure waiting to happen — it switches the working tree, so a dirty
      // repository answered "Your local changes to the following files would be
      // overwritten by checkout … Aborting" and no branch was created at all
      // (verified in the browser on the second commit of a dirty fixture).
      await expectOk(
        startPoint ? ['branch', branch, startPoint] : ['branch', branch],
        targetDir,
      );
    } else if (actionType === 'history' || actionType === 'graph') {
      const limit = parseInt((formData.get('limit') as string) || String(COMMIT_PAGE_SIZE), 10);
      const skip = parseInt((formData.get('skip') as string) || '0', 10);
      const result = await fetchGitCommits(targetDir, limit, skip);
      return json({
        success: true,
        type: actionType,
        data: result.commits,
        hasMore: result.hasMore,
        total: result.total,
        limit,
        skip,
      });
    } else if (actionType === 'commit_diff') {
      const hash = (formData.get('hash') as string) || '';
      const file = (formData.get('file') as string) || '';
      // `full=1` is the commit modal's "Expand all context": git's default patch
      // is three lines around the change, so the button needs a re-read rather
      // than a client-side expansion of a payload that holds nothing more.
      const full = formData.get('full') === '1';
      const diff = await fetchFileDiff(targetDir, hash, file, full);
      return json({ success: true, diff });
    } else if (actionType === 'file_diff') {
      const file = (formData.get('file') as string) || '';
      const staged = formData.get('staged') === '1' || formData.get('staged') === 'true';
      const diffData = await fetchWorkingFileDiff(targetDir, file, staged);
      return json({ success: true, ...diffData });
    } else if (actionType === 'cherry_pick') {
      await expectOk(['cherry-pick', formData.get('hash') as string], targetDir);
    } else if (actionType === 'revert_commit') {
      await expectOk(['revert', '--no-edit', formData.get('hash') as string], targetDir);
    } else if (actionType === 'reset_commit') {
      const mode = (formData.get('mode') as string) || 'soft';
      await expectOk(['reset', `--${mode}`, formData.get('hash') as string], targetDir);
    } else if (actionType === 'merge_commit') {
      await expectOk(['merge', formData.get('hash') as string], targetDir);
    } else if (actionType === 'rebase_commit') {
      await expectOk(['rebase', formData.get('hash') as string], targetDir);
    } else if (actionType === 'push') {
      await pushBranch(targetDir);
      markRemoteRefsFresh(targetDir);
    } else if (actionType === 'pull') {
      await pullBranch(targetDir);
      markRemoteRefsFresh(targetDir);
    } else if (actionType === 'sync') {
      await pullBranch(targetDir);
      await pushBranch(targetDir);
      // Both commands already moved the tracking ref; the next read must not
      // fetch again to see a state it just produced.
      markRemoteRefsFresh(targetDir);
    }
    // Every accepted mutation announces the tree it changed. The panel's list
    // comes from the `git:` topic, so without this a stage/unstage/discard left
    // the change list showing the pre-action state until some unrelated tool
    // call happened to republish (verified: Stage posted, the row stayed under
    // "Changes").
    emitRealtimeSignal('workspace-dirty');
    return json({ success: true });
  } catch (error: unknown) {
    console.error('Git action error:', error);
    const reason = error instanceof Error ? error.message : String(error);
    return json({ success: false, error: reason || 'Operation failed' }, { status: 400 });
  }
}

/**
 * The repo-relative path a single-file action names, refused when it escapes
 * the working tree.
 *
 * `resolveRepoPath` is what makes the guard real: the untracked branch of a
 * discard REMOVES the path, so a client-supplied `../../x` must not become a
 * filesystem target. Git itself bounds a pathspec, but the removal does not go
 * through git.
 */
function fileForAction(formData: FormData, targetDir: string): string {
  const raw = (formData.get('file') as string) ?? '';
  const relative = repoRelative(raw);
  if (!resolveRepoPath(targetDir, relative)) {
    throw new Error(`Invalid path: ${raw}`);
  }
  return relative;
}

/**
 * Restore one path to its committed state, discarding local changes.
 *
 * Three steps, because a single git command cannot cover the states a change
 * can be in:
 *
 *  1. `git reset -q -- <path>` unstages it. `git restore --staged` is the
 *     obvious form but it resolves HEAD and refuses outright in a repository
 *     whose first commit is still staged ("could not resolve 'HEAD'"), so a
 *     discard there left the file staged and reported success (verified).
 *  2. `git checkout -- <path>` restores a tracked change. It works with an
 *     unborn HEAD and it never touches an untracked path (it exits non-zero,
 *     which is not a failure here).
 *  3. `git clean -fd -- <path>` removes what step 2 left: an untracked file, or
 *     a file that was only ever staged.
 *
 * The previous shape (`git restore`, and on ANY failure `fs.rmSync` the path)
 * is why a discard could destroy committed work: for a folder holding a clean
 * tracked file beside an untracked one, `git status --porcelain -- <dir>` opens
 * with `??` — that branch took `rm -rf` and deleted the tracked file too
 * (verified: the committed `dir/keep.txt` was gone and the tree read ` D`). It
 * also deleted a modified TRACKED file whenever the restore failed for an
 * unrelated reason, such as a filename holding a double quote.
 */
async function revertPath(targetDir: string, file: string): Promise<void> {
  const unstaged = await runGit(['reset', '-q', '--', file], { cwd: targetDir });
  if (unstaged.error) throw unstaged.error;

  const restored = await runGit(['checkout', '--', file], { cwd: targetDir });
  // A path git does not know (untracked, or already gone) is not a failure —
  // the clean below is what removes it.
  if (!restored.error && restored.exitCode !== 0 && !/pathspec/i.test(restored.stderr)) {
    throw new Error(restored.stderr.trim() || `git checkout exited with code ${restored.exitCode}`);
  }

  const cleaned = await runGit(['clean', '-fd', '--', file], { cwd: targetDir });
  if (cleaned.error) throw cleaned.error;
  if (cleaned.exitCode !== 0) {
    throw new Error(cleaned.stderr.trim() || `git clean exited with code ${cleaned.exitCode}`);
  }
}

/** Runs a git command and throws with its stderr when it exits non-zero. */
async function expectOk(args: string[], cwd: string, timeout?: number): Promise<GitRunResult> {
  const result = await runGit(args, { cwd, timeout, maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.exitCode}`);
  }
  return result;
}

/** True when the ref resolves; `--quiet` keeps stderr clean on a miss. */
async function refExists(ref: string, cwd: string): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', '--quiet', ref], { cwd });
  return result.exitCode === 0;
}
