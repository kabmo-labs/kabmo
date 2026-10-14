/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Source Control panel's conflict and branch surfaces, in a real browser
 * against a real repository.
 *
 * This layer exists because the bugs these features had are INVISIBLE to a unit
 * test: a conflicted file rendered twice (once under "Staged Changes", once
 * under "Changes") because the porcelain columns were read as index/worktree
 * when an unmerged pair is the two SIDES of a conflict; the operation bar never
 * appeared because the panel had no state read at all; the delete checkbox did
 * nothing because the confirm path dropped its `force` flag; and `Continue` on
 * a rebase left the rebase RUNNING because the verb was hard-coded to
 * `git commit --no-edit`. Each of those is a real DOM, a real git state and a
 * real click — exactly what a component test cannot assemble.
 *
 * The assertions read the OBSERVABLE that actually changes, never the control
 * that was clicked: the operation bar's own text, the branch list's own rows,
 * and git's own state read back over the API. A screenshot of the panel proves
 * nothing about whether a merge concluded.
 *
 * Fixtures come from `seedWorkingRepo` (a scratch repository with its own
 * identity), and every state the spec drives is produced by REAL git in that
 * repository — a hand-written `.git` directory would test the fixture.
 */

import { test, expect, openApp } from '../fixtures/app';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedWorkspace, waitUntil } from '../fixtures/seed';
import { seedWorkingRepo, seedConflictingBranches, type SeedWorkingRepo } from '../fixtures/git-repo';
import type { HarnessServer } from '../fixtures/server';

/**
 * Every scratch resource a test creates, cleaned in `afterEach`.
 *
 * `dispose()` at the END of a test body is not enough: a spec that fails (or is
 * retried) skips it, and the scratch repository and the seeded workspace's temp
 * directory leak into `TMPDIR` — measured, 187 seeded-workspace dirs and 36
 * repository dirs left behind after a handful of runs. A per-test registry
 * cleaned by a hook runs on the failure path too, so a red spec is still tidy.
 */
const scratch: Array<{ dispose(): void }> = [];

test.afterEach(() => {
  while (scratch.length > 0) scratch.pop()?.dispose();
});

/** A scratch repository, registered for cleanup. */
function makeRepo(name: string): SeedWorkingRepo {
  const repo = seedWorkingRepo(name);
  scratch.push(repo);
  return repo;
}

/**
 * Register a workspace bound to `repo` and open Source Control on it.
 *
 * The folder is created through the REAL API and re-pointed at the scratch
 * repository through the same settings endpoint the UI's own folder dialog
 * uses, so `project_path` is resolved by the route rather than written by hand
 * into the database.
 *
 * Registration MUST happen before any git action: `resolveRoot` only accepts
 * the app root, a path beneath it, or a registered `project_path`, so a
 * `/api/fs/git` call naming an unregistered scratch directory falls back to the
 * app root — it would run the merge against THE CHAMBER REPOSITORY.
 */
async function openGitPanel(
  page: import('@playwright/test').Page,
  server: HarnessServer,
  repo: SeedWorkingRepo,
): Promise<void> {
  const workspace = await seedWorkspace(server, `e2e-git-${Date.now()}`);
  // `seedWorkspace` mints a temp dir of its own; it is cleaned here so a spec
  // cannot forget it.
  scratch.push(workspace);
  const patched = await fetch(`${server.baseURL}/api/folders/${workspace.id}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectPath: repo.path }),
  });
  if (!patched.ok) {
    throw new Error(`re-pointing the workspace failed: ${patched.status} ${await patched.text()}`);
  }
  await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
  await showSourceControl(page);
}

/**
 * Make the right panel visible on Source Control.
 *
 * Split out because the panel COLLAPSES on reload (its open flag is per-session
 * UI state that a reload re-reads), so every post-reload assertion has to go
 * through this first. A click on a hidden button is what made the conflict spec
 * flaky: it timed out waiting for a control inside a zero-width panel.
 */
async function showSourceControl(page: import('@playwright/test').Page): Promise<void> {
  const rightPanel = page.locator('[data-panel-id="right-panel"]');
  const width = (await rightPanel.boundingBox())?.width ?? 0;
  if (width === 0) {
    await page.getByRole('button', { name: /toggle right panel/i }).click();
    // Wait for the panel to actually take space, not for a duration.
    await expect.poll(async () => (await rightPanel.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Source Control' }).click();
  await expect(page.getByPlaceholder(/commit message/i)).toBeVisible();
}

/**
 * Run one git action against `repo` through the route the panel uses.
 *
 * Only legal AFTER `openGitPanel` has registered the folder — see there for why
 * an unregistered root silently redirects to the chamber's own repository.
 */
async function gitAction(
  server: HarnessServer,
  repo: SeedWorkingRepo,
  fields: Record<string, string>,
  /** A spec that drives a REFUSAL passes this, so the expected 400 is returned. */
  options: { allowRefusal?: boolean } = {},
): Promise<{ success?: boolean; error?: string }> {
  const response = await fetch(`${server.baseURL}/api/fs/git`, {
    method: 'POST',
    body: formBody({ ...fields, root: repo.path, repo: '.' }),
  });
  const body = (await response.json()) as { success?: boolean; error?: string };
  // A refused action is reported, never swallowed. The spec used to ignore this
  // response, so a merge that failed on the server left the fixture mid-flight
  // and the spec died 20s later on a timeout that named nothing — the failure
  // read as a flaky panel rather than a rejected git command. A spec that is
  // TESTING a refusal opts out with `allowRefusal`.
  if (!options.allowRefusal && (!response.ok || body.success === false)) {
    throw new Error(`git action ${fields.actionType} failed (HTTP ${response.status}): ${body.error ?? JSON.stringify(body)}`);
  }
  return body;
}

/** git's own view of the working tree, read back over the API the panel uses. */
async function readState(server: HarnessServer, repo: SeedWorkingRepo): Promise<{ operation: string | null; conflicts: string[] }> {
  const params = new URLSearchParams({ root: repo.path, repo: '.' });
  const response = await fetch(`${server.baseURL}/api/fs/git?${params.toString()}`);
  const body = (await response.json()) as { state?: { operation: string | null; conflicts: string[] } };
  return {
    operation: body.state?.operation ?? null,
    conflicts: body.state?.conflicts ?? [],
  };
}

test.describe('Source Control — merge conflicts', () => {
  test('a conflicted file is listed ONCE, under Conflicts, and the operation bar appears', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-conflict');
    seedConflictingBranches(repo);

    // Register the workspace FIRST, then start the merge: the route refuses an
    // unregistered root, so a merge issued before this would have run against
    // the chamber's own repository.
    await openGitPanel(page, server, repo);
    await gitAction(server, repo, { actionType: 'merge_branch', branch: 'feature' });
    // Wait for git's OWN state to report the merge before reloading. The merge
    // action resolves when the command exits, but the panel reads its state from
    // the realtime topic, which republishes on a coalesced schedule — a reload
    // issued in that window rebuilt the panel from a snapshot taken before the
    // merge, so the operation bar was absent and the spec failed. Waiting on the
    // condition (not a duration) is what makes it deterministic.
    await waitUntil(async () => (await readState(server, repo)).operation === 'merge');
    // The panel re-reads from the realtime topic; reload so the operation bar
    // is rendered from the state the merge just produced.
    await page.reload();
    await showSourceControl(page);

    // The operation bar is the thing the panel could not show before.
    await expect(page.getByRole('button', { name: /abort merge/i })).toBeVisible();
    await expect(page.getByText(/1 conflict left/)).toBeVisible();
    // Continue is offered but disabled while a conflict remains.
    const cont = page.getByRole('button', { name: /continue merge/i });
    await expect(cont).toBeDisabled();

    // The file is listed under Conflicts and NOWHERE ELSE. The bar above also
    // names it (its own conflict list), so the count is scoped to the section
    // heading's sibling rows rather than the whole page.
    await expect(page.getByText('Conflicts', { exact: true })).toBeVisible();
    await expect(page.locator('[class*="group"]').filter({ hasText: 'shared.txt' })).toHaveCount(1);
    // And NOT under the staged heading — the mis-read porcelain column put
    // every conflicted file there, and also under Changes, so it rendered twice.
    await expect(page.getByText('Staged Changes', { exact: true })).toHaveCount(0);

  });

  test('resolving through the UI concludes the merge with a real merge commit', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-resolve');
    seedConflictingBranches(repo);

    await openGitPanel(page, server, repo);
    await gitAction(server, repo, { actionType: 'merge_branch', branch: 'feature' });
    // Same race as the conflict spec: wait for git's own state before reloading,
    // or the panel rebuilds from a snapshot taken before the merge.
    await waitUntil(async () => (await readState(server, repo)).operation === 'merge');
    await page.reload();
    await showSourceControl(page);

    // Expand the conflicted row and take the incoming side. The buttons are
    // labelled from the file's OWN conflict markers, never "ours"/"theirs" —
    // `--ours`/`--theirs` are inverted during a rebase.
    const expand = page.getByRole('button', { name: /show resolve actions/i });
    await expect(expand).toBeVisible();
    await expand.click();
    const takeIncoming = page.getByRole('button', { name: 'take feature' });
    await expect(takeIncoming).toBeVisible();
    await takeIncoming.click();

    // The conflict clears and Continue becomes usable.
    await expect(page.getByText(/all conflicts resolved/)).toBeVisible();
    const cont = page.getByRole('button', { name: /continue merge/i });
    await expect(cont).toBeEnabled();
    await cont.click();

    // The bar is gone and git agrees the merge is concluded — the observable
    // that matters, read from git itself.
    await expect(page.getByRole('button', { name: /abort merge/i })).toHaveCount(0);
    await waitUntil(async () => (await readState(server, repo)).operation === null);
    expect(repo.git('log', '-1', '--pretty=%s').trim()).toBe("Merge branch 'feature'");

  });

  test('abort restores the pre-merge tree and asks first', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-abort');
    seedConflictingBranches(repo);

    await openGitPanel(page, server, repo);
    await gitAction(server, repo, { actionType: 'merge_branch', branch: 'feature' });
    // Wait for git's own state before reloading — see the conflict spec.
    await waitUntil(async () => (await readState(server, repo)).operation === 'merge');
    await page.reload();
    await showSourceControl(page);
    // The merge was driven through the API, so the panel learns of it from the
    // realtime topic. Assert the bar is on screen before clicking — a bare
    // click raced the publish and timed out on a control that had not rendered.
    const abortMerge = page.getByRole('button', { name: /abort merge/i });
    await expect(abortMerge).toBeVisible();
    await abortMerge.click();

    // A destructive action asks, and the question names the operation.
    await expect(page.getByText(/Abort the merge\?/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await waitUntil(async () => (await readState(server, repo)).operation === null);
    expect(repo.git('status', '--porcelain').trim()).toBe('');
    expect(repo.git('log', '-1', '--pretty=%s').trim()).toBe('main change');

  });

  test('a rebase conflict is concluded by rebase --continue, not by a bare commit', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-rebase');
    seedConflictingBranches(repo);

    await openGitPanel(page, server, repo);
    await gitAction(server, repo, { actionType: 'rebase_commit', hash: repo.git('rev-parse', 'feature').trim() });
    // Wait for git's own state before reloading — a rebase reads as `rebase`.
    await waitUntil(async () => (await readState(server, repo)).operation === 'rebase');
    await page.reload();
    await showSourceControl(page);
    // The bar names the operation it found — a rebase, not a merge.
    await expect(page.getByRole('button', { name: /abort rebase/i })).toBeVisible();

    await page.getByRole('button', { name: /show resolve actions/i }).click();
    await page.getByRole('button', { name: /^take / }).last().click();
    const cont = page.getByRole('button', { name: /continue rebase/i });
    await expect(cont).toBeEnabled();
    await cont.click();

    // The rebase must be FINISHED. `git commit --no-edit` used to make the
    // commit and leave `rebase-merge` behind, so the bar never cleared.
    await waitUntil(async () => (await readState(server, repo)).operation === null);
    await expect(page.getByRole('button', { name: /abort rebase/i })).toHaveCount(0);
    expect(repo.git('status', '--porcelain').trim()).toBe('');

  });

  test('a resolved stash pop offers NO Continue, because there is nothing to conclude', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-stashpop');
    seedConflictingBranches(repo);
    // Build the one conflict state with no operation file: stash a change to the
    // same line, move that line, then pop onto it. `stash push` with a clean
    // tree saves nothing ("No local changes to save"), so the edit comes first.
    writeFileSync(join(repo.path, 'shared.txt'), 'line one\nSTASHED\nline three\n');
    repo.git('stash', 'push', '-q', '-m', 'wip');
    writeFileSync(join(repo.path, 'shared.txt'), 'line one\nMOVED\nline three\n');
    repo.git('commit', '-q', '-am', 'moved on');
    repo.gitAllowFail('stash', 'pop');

    await openGitPanel(page, server, repo);
    await expect(page.getByRole('button', { name: /abort stash pop/i })).toBeVisible();
    // The button whose only outcome would be a refusal is not drawn.
    await expect(page.getByRole('button', { name: /continue stash pop/i })).toHaveCount(0);

  });

  test('discard is refused on a conflicted file, leaving the merge open', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-nodiscard');
    seedConflictingBranches(repo);

    await openGitPanel(page, server, repo);
    await gitAction(server, repo, { actionType: 'merge_branch', branch: 'feature' });
    // The API refuses; the panel surfaces the reason rather than destroying the
    // conflict and leaving MERGE_HEAD behind (the old behaviour).
    const body = await gitAction(server, repo, { actionType: 'revert', file: 'shared.txt' }, { allowRefusal: true });
    expect(body.success).toBe(false);
    expect(body.error).toContain('conflicted');
    expect((await readState(server, repo)).operation).toBe('merge');

  });
});

test.describe('Source Control — branch management', () => {
  test('the modal lists branches with their tracking state and renames one in place', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-branch');
    repo.git('commit', '-q', '--allow-empty', '-m', 'base');
    repo.git('branch', 'feature');
    repo.git('branch', 'spike');

    await openGitPanel(page, server, repo);

    // The dropdown opens the modal.
    await page.getByRole('button', { name: 'main', exact: true }).click();
    await page.getByRole('button', { name: 'Manage branches...' }).click();
    await expect(page.getByRole('heading', { name: 'Branches' })).toBeVisible();
    // Every branch has a row, and an unpublished one says so rather than
    // reporting ↑0 ↓0 (which would hide unpushed commits). `exact` on the name
    // so `feature` does not also match a longer branch beside it.
    await expect(page.getByText('feature', { exact: true })).toBeVisible();
    await expect(page.getByText('unpublished').first()).toBeVisible();

    // Rename it; the list re-reads and shows the new name without a reopen.
    await page.getByRole('button', { name: 'Rename feature' }).click();
    const nameField = page.locator('#branch-rename-input');
    await expect(nameField).toBeVisible();
    await nameField.fill('feature-renamed');
    // The value must SURVIVE the fill. It did not before: the dialog seeded its
    // field from an effect keyed on the branch, and the parent re-renders as the
    // list reloads, so the effect put the OLD name back over the keystroke.
    expect(await nameField.inputValue()).toBe('feature-renamed');
    // The submit is disabled until the name actually moved; asserting that
    // first is what makes the click below deterministic.
    const renameSubmit = page.getByRole('button', { name: 'Rename', exact: true });
    await expect(renameSubmit).toBeEnabled();
    await renameSubmit.click();

    await expect(page.getByText('feature-renamed', { exact: true })).toBeVisible();
    await waitUntil(async () => repo.git('branch', '--format=%(refname:short)').includes('feature-renamed'));
    expect(repo.git('branch', '--format=%(refname:short)')).not.toContain('feature\n');

  });

  test('an unmerged branch is refused with -d and deleted with the force checkbox', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-force');
    repo.git('commit', '-q', '--allow-empty', '-m', 'base');
    repo.git('checkout', '-q', '-b', 'unmerged');
    repo.git('commit', '-q', '--allow-empty', '-m', 'unmerged work');
    repo.git('checkout', '-q', 'main');

    await openGitPanel(page, server, repo);
    await page.getByRole('button', { name: 'main', exact: true }).click();
    await page.getByRole('button', { name: 'Manage branches...' }).click();

    // First attempt: the dialog's own confirmation, without the force box.
    await page.getByRole('button', { name: 'Delete unmerged' }).click();
    await expect(page.getByText(/git branch -d unmerged/)).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    // git refuses, and the branch is still there.
    await waitUntil(async () => repo.git('branch', '--format=%(refname:short)').includes('unmerged'));

    // Second attempt, with force ticked: the checkbox changes the command the
    // dialog shows AND what it runs. Without the flag reaching the route the
    // box was cosmetic. The command is asserted INSIDE the dialog — the toast
    // from the refusal above quotes the same sentence, and the branch modal is
    // itself a dialog, so the delete dialog is picked by its own heading.
    await page.getByRole('button', { name: 'Delete unmerged' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Delete branch' });
    await dialog.getByLabel(/delete even if/i).check();
    await expect(dialog.getByText('git branch -D unmerged')).toBeVisible();
    await dialog.getByRole('button', { name: /Delete \(force\)/ }).click();

    await waitUntil(async () => !repo.git('branch', '--format=%(refname:short)').includes('unmerged'));

  });
});

test.describe('Source Control — stash and commit', () => {
  test('a stash entry is listed with its subject and dropped only after a confirmation', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-stash');
    repo.git('commit', '-q', '--allow-empty', '-m', 'base');
    // Something to stash, made by real git before the panel opens.
    writeFileSync(join(repo.path, 'wip.txt'), 'work in progress\n');
    repo.git('add', '-A');
    repo.git('stash', 'push', '-q', '-m', 'e2e stash');

    await openGitPanel(page, server, repo);
    // Two buttons read `Stash`: the repo header's label and the section's
    // toggle. The toggle is the one carrying the disclosure title.
    await page.getByRole('button', { name: 'Stash', description: 'Show stashes' }).click();

    // The list is fetched when the section opens, and the row carries the
    // reflog subject git wrote — not the raw `stash@{0}` alone.
    await expect(page.getByText(/e2e stash/)).toBeVisible();

    // A drop asks first; the entry survives the dialog until it is confirmed.
    await page.getByRole('button', { name: 'Drop stash' }).click();
    await expect(page.getByText(/Drop stash@\{0\}\?/)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm' }).click();

    // An empty stash makes `git stash list` exit 128 ("bad revision
    // 'refs/stash'"), so the poll reads it tolerantly — the empty OUTPUT is the
    // success condition, not a zero exit.
    await waitUntil(async () => repo.gitAllowFail('stash', 'list').trim() === '');
    await expect(page.getByText(/No stash entries/)).toBeVisible();

  });

  test('amend rewrites the previous commit instead of adding one', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = makeRepo('git-amend');
    repo.git('commit', '-q', '--allow-empty', '-m', 'first commit');
    const before = repo.git('log', '--oneline').trim().split('\n').length;
    // An amend needs something to fold in: a staged change. `git commit
    // --amend` with an empty index only rewrites the message, which is legal
    // but not what this spec is about.
    writeFileSync(join(repo.path, 'extra.txt'), 'amended in\n');
    repo.git('add', '-A');

    await openGitPanel(page, server, repo);
    await page.getByLabel('Amend').check();
    await page.getByPlaceholder(/new message for the previous commit/i).fill('amended subject');
    await page.getByRole('button', { name: 'Amend commit' }).click();

    await waitUntil(async () => repo.git('log', '-1', '--pretty=%s').trim() === 'amended subject');
    // The count did NOT grow: it replaced, not appended.
    expect(repo.git('log', '--oneline').trim().split('\n').length).toBe(before);

  });
});

/** A FormData body for the git route, as the panel submits it. */
function formBody(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}
