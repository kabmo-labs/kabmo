/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `GET /api/fs/git` — the Source Control panel's data, and the file-diff /
 * commit-history endpoints the diff panel and commit modal read.
 *
 * Repository discovery (`?reposOnly=1`) is a background walk over the scoped
 * root; see `lib/fs/git-repos.ts`. The mutating actions live in
 * `lib/fs/git-actions.ts` as a dispatch table — this module owns the REQUEST
 * shape (root/repo resolution, the 400 envelope, the realtime signal) and
 * nothing else.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import path from 'path';
import { COMMIT_PAGE_SIZE } from '@/shared/lib/fs/commit-page';
import { resolveRoot } from '@/server/lib/fs/root';
import { discoveredRepos, rescanRepos, startRepoScan } from '@/server/lib/fs/git-repos';
import { fetchGitCommits, readHeadCommitMessage } from '@/server/lib/fs/git-log';
import { fetchWorkingFileDiff } from '@/server/lib/fs/git-diff';
import { repoRelative, resolveRepoPath } from '@/server/lib/fs/git-run';
import { parseConflictMarkers } from '@/shared/lib/fs/git-unmerged';
import { readGitStatus } from '@/server/lib/fs/git-status-read';
import { listBranchDetails } from '@/server/lib/fs/git-branch';
import { listStashes } from '@/server/lib/fs/git-stash';
import { GIT_ACTIONS } from '@/server/lib/fs/git-actions';
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

  // The branch management modal's own read: one `for-each-ref` carrying the
  // metadata a branch row shows (upstream, ahead/behind, last commit). Kept off
  // the status payload because the status read is on the realtime topic and
  // republished on every tool call, while this is opened by hand.
  if (url.searchParams.get('branches') === '1') {
    return json({ success: true, branches: await listBranchDetails(targetDir) });
  }

  // The stash section's read: the entry list. Cheap (one `stash list`) and off
  // the status payload for the same reason as the branch list.
  if (url.searchParams.get('stashes') === '1') {
    return json({ success: true, stashes: await listStashes(targetDir) });
  }

  // The amend draft's read: the message the checkbox would rewrite. On demand
  // for the same reason the branch list and the stash are — the status read
  // travels on the realtime `git:` topic and is republished on every tool call,
  // so a payload nobody asked for would pay one `git log` per tool call.
  if (url.searchParams.get('headMessage') === '1') {
    return json({ success: true, message: await readHeadCommitMessage(targetDir) });
  }

  // The side labels a resolve button is named from, read on demand.
  //
  // NOT part of the status payload: it means reading the file, and the status
  // read is republished on every tool call — a repository with fifty conflicts
  // would pay fifty file reads per publish. This is one read, when the user
  // opens the resolve menu, which is the only moment the labels are shown.
  if (url.searchParams.get('conflictMarkers') === '1') {
    const file = url.searchParams.get('file') || '';
    const relative = repoRelative(file);
    const resolved = resolveRepoPath(targetDir, relative);
    if (!resolved) return json({ error: 'Invalid path' }, { status: 403 });
    const text = await Bun.file(resolved).text().catch(() => '');
    return json({ success: true, markers: parseConflictMarkers(text) });
  }

  // Ahead/behind are only requested by the git panel (`?sync=1`); the
  // status-only reads (activity bar, file explorer) must not trigger a network
  // fetch, and must not pay for a count they never read.
  //
  // The read itself lives in `lib/fs/git-status-read.ts`, so the realtime `git:`
  // topic and this route answer from one implementation — including the
  // operation/conflict state, which a merge started by a tool call has to reach
  // the panel through.
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

  const handler = GIT_ACTIONS[actionType];
  if (!handler) return json({ error: `Unknown git action: ${actionType}` }, { status: 400 });

  try {
    const result = await handler({ formData, targetDir });
    // Every accepted mutation announces the tree it changed. The panel's list
    // comes from the `git:` topic, so without this a stage/unstage/discard left
    // the change list showing the pre-action state until some unrelated tool
    // call happened to republish (verified: Stage posted, the row stayed under
    // "Changes"). A read action that answered with a page is not a mutation,
    // but republishing costs one coalesced resolve and keeps the two paths one.
    emitRealtimeSignal('workspace-dirty');
    return json(result ?? { success: true });
  } catch (error: unknown) {
    console.error('Git action error:', error);
    const reason = error instanceof Error ? error.message : String(error);
    return json({ success: false, error: reason || 'Operation failed' }, { status: 400 });
  }
}
