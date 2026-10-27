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

import { test, expect, openApp, skipOnWindows } from '../fixtures/app';
import type { Locator, Page } from '@playwright/test';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { seedWorkspace, waitUntil } from '../fixtures/seed';
import { seedWorkingRepo, seedWorkingRepoIn, seedConflictingBranches, seedCloneParent, type SeedWorkingRepo } from '../fixtures/git-repo';
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
 * app root — it would run the merge against THE Kabmo REPOSITORY.
 */
async function openGitPanel(
  page: Page,
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
async function showSourceControl(page: Page): Promise<void> {
  // Wait for the app to MOUNT before reading anything. Every caller reaches here
  // right after a reload, and a query issued against the pre-mount document
  // finds no panel — the width reads 0, the toggle click lands on a button that
  // does not exist yet, and the spec fails on a control it never had a chance to
  // see (measured in CI: `getByPlaceholder(/commit message/i)` timed out on a
  // reload that had not hydrated).
  await expect(page.locator('[data-testid="app-root"]')).toBeVisible();
  const rightPanel = page.locator('[data-panel-id="right-panel"]');
  const width = (await rightPanel.boundingBox())?.width ?? 0;
  if (width === 0) {
    await page.getByRole('button', { name: /toggle right panel/i }).click();
    // Wait for the panel to actually take space, not for a duration.
    await expect.poll(async () => (await rightPanel.boundingBox())?.width ?? 0).toBeGreaterThan(0);
  }
  await page.getByRole('button', { name: 'Source Control' }).click();
  // The panel's own Refresh control, NOT the commit-message box: while a merge
  // is stopped on a conflict the box is replaced by the operation bar, so
  // anchoring on it failed exactly on the specs that had a conflict to show
  // (measured in CI — the bar was on screen and the box was not). Refresh is in
  // the repo header in every state.
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeVisible();
}

/**
 * Run one git action against `repo` through the route the panel uses.
 *
 * Only legal AFTER `openGitPanel` has registered the folder — see there for why
 * an unregistered root silently redirects to Kabmo's own repository.
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
    // Kabmo's own repository.
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
    skipOnWindows('drives git conflict state through a shell fixture');
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
    skipOnWindows('drives git conflict state through a shell fixture');
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
    skipOnWindows('drives git conflict state through a shell fixture');
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
    skipOnWindows('drives git conflict state through a shell fixture');
    const server = await harness('real');
    const repo = makeRepo('git-stash');
    repo.git('commit', '-q', '--allow-empty', '-m', 'base');
    // Something to stash, made by real git before the panel opens.
    writeFileSync(join(repo.path, 'wip.txt'), 'work in progress\n');
    repo.git('add', '-A');
    repo.git('stash', 'push', '-q', '-m', 'e2e stash');
    // ...and a change left BEHIND, so the change list renders its own
    // `Changes` header. That header is the reference the glyph parity check
    // below compares against, and on a clean tree it does not exist at all —
    // the assertion then matched the stash glyph against ITSELF and passed
    // whatever the markup said (measured: removing `font-mono` kept it green).
    writeFileSync(join(repo.path, 'left-behind.txt'), 'still here\n');

    await openGitPanel(page, server, repo);

    // The section is PINNED to the panel's floor, below the change list: the
    // panel is a flex column whose list is the `flex-1` member, so opening the
    // stash shrinks the list rather than pushing the section down a scroller
    // the reader would have to chase. Both halves are asserted here because
    // either alone is satisfied by the wrong layout — a section merely *after*
    // the list in the DOM would still grow downwards if the list were not
    // flexible.
    const toggle = page.getByRole('button', { name: 'Stash', description: 'Show stashes' });
    const commitBox = page.getByPlaceholder(/commit message/i);
    const panel = page.locator('[data-panel-id="right-panel"]');
    await expect(toggle).toBeVisible();
    const commitBoxRect = await commitBox.boundingBox();
    const toggleBox = await toggle.boundingBox();
    const panelBox = await panel.boundingBox();
    // Below the commit box (which itself sits above the change list)...
    expect(toggleBox!.y).toBeGreaterThan(commitBoxRect!.y);
    // ...and at the panel's own bottom edge, not somewhere in the middle.
    expect(panelBox!.y + panelBox!.height - (toggleBox!.y + toggleBox!.height)).toBeLessThan(48);

    // The disclosure glyph must be the SAME mark as the change list's, in the
    // same face. It is a text character, so a header that does not inherit the
    // list's `font-mono` draws the identical codepoint at the identical
    // font-size a quarter smaller: measured ink 4.65px in `ui-monospace`
    // against 3.49px in the app's sans stack, which is what "the icon is too
    // small" was. The comparison is made against the live Changes glyph, so a
    // future restyle of either header cannot silently re-open the gap.
    const glyphStyle = async (locator: Locator) => locator.evaluate((el) => {
      const cs = getComputedStyle(el);
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = ctx.measureText(el.textContent!.trim());
      return {
        font: cs.fontFamily,
        size: cs.fontSize,
        weight: cs.fontWeight,
        ink: +(m.actualBoundingBoxLeft + m.actualBoundingBoxRight).toFixed(2),
      };
    });
    const stashGlyph = await glyphStyle(toggle.locator('span').first());
    // The reference is the `Changes` section header's own glyph — addressed
    // through its header row, never by position: on a tree with nothing left
    // to list that header does not render, and a positional `.first()` would
    // silently compare the stash glyph with itself.
    const changesHeader = page
      .locator('[data-panel-id="right-panel"] div')
      .filter({ hasText: /^[▸▾]\s*Changes/ })
      .first();
    await expect(changesHeader).toBeVisible();
    const changesGlyph = await glyphStyle(changesHeader.locator('span').first());
    expect(stashGlyph.font).toBe(changesGlyph.font);
    expect(stashGlyph.size).toBe(changesGlyph.size);
    expect(stashGlyph.ink).toBeGreaterThan(changesGlyph.ink - 0.01);

    // Two buttons read `Stash`: the repo header's label and the section's
    // toggle. The toggle is the one carrying the disclosure title.
    //
    // It is clicked in the MIDDLE of the row, well to the right of the words
    // `Stash` — the exact gesture that used to do nothing. The toggle wrapped
    // the label alone, so the empty span between the label and `Save` was a
    // measured 189px dead strip on a 334px-wide panel, and a reader who
    // "clicked the section row" got nothing. A click on the label would pass
    // even with that bug, so the label is deliberately NOT the target.
    const labelBox = await toggle.locator('span', { hasText: 'Stash' }).boundingBox();
    const midRowX = labelBox!.x + 160;
    expect(midRowX).toBeLessThan(toggleBox!.x + toggleBox!.width);
    await page.mouse.click(midRowX, toggleBox!.y + toggleBox!.height / 2);

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
    // Ticking Amend loads the message it is about to rewrite — the whole
    // message, editable, so the common amend is a tweak rather than a retype.
    const draft = page.getByPlaceholder(/new message for the previous commit/i);
    await expect(draft).toHaveValue('first commit');
    // The box says where the text came from, so an auto-filled draft is not
    // read as a stale one the user left behind.
    await expect(page.getByText('previous message loaded')).toBeVisible();
    // And it is ordinary text: replacing it entirely is the user's call.
    await draft.fill('amended subject');
    // Edited, so the note is gone — the draft is theirs from here on.
    await expect(page.getByText('previous message loaded')).toBeHidden();
    await page.getByRole('button', { name: 'Amend commit' }).click();

    await waitUntil(async () => repo.git('log', '-1', '--pretty=%s').trim() === 'amended subject');
    // The count did NOT grow: it replaced, not appended.
    expect(repo.git('log', '--oneline').trim().split('\n').length).toBe(before);

  });
});

test.describe('Source Control — sync', () => {
  /**
   * A workspace repository with one commit on BOTH sides: one local, one on
   * origin. `--ff-only` refuses this ("Not possible to fast-forward"), so Sync
   * threw before its push and the badge stayed at ↑1 ↓1 — the reported "the
   * sync button does nothing". The assertion is git's own counts afterwards,
   * not the toast: only a real merge makes them zero.
   */
  function seedDivergedRepo(name: string): SeedWorkingRepo {
    const repo = makeRepo(name);
    const origin = seedCloneParent(`${name}-origin`);
    scratch.push(origin);
    // `repo.git` always runs in the repository, so the bare origin is reached
    // with `-C` rather than a second runner.
    repo.git('-C', origin.path, 'init', '-q', '--bare', '-b', 'main');
    repo.git('remote', 'add', 'origin', origin.path);
    writeFileSync(join(repo.path, 'seed.txt'), 'seed\n');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'seed');
    repo.git('push', '-q', '-u', 'origin', 'main');

    // The other half of the divergence, from a second clone.
    const other = seedCloneParent(`${name}-other`);
    scratch.push(other);
    repo.git('clone', '-q', origin.path, other.path);
    repo.git('-C', other.path, 'config', 'user.email', 'e2e@example.invalid');
    repo.git('-C', other.path, 'config', 'user.name', 'E2E');
    writeFileSync(join(other.path, 'remote.txt'), 'remote\n');
    repo.git('-C', other.path, 'add', '-A');
    repo.git('-C', other.path, 'commit', '-q', '-m', 'remote work');
    repo.git('-C', other.path, 'push', '-q');

    writeFileSync(join(repo.path, 'local.txt'), 'local\n');
    repo.git('add', '-A');
    repo.git('commit', '-q', '-m', 'local work');
    // The counts compare against the LOCAL tracking ref, so the other clone's
    // push is invisible until a fetch moves it.
    repo.git('fetch', '-q');
    return repo;
  }

  test('a diverged branch syncs to a merge instead of refusing', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = seedDivergedRepo('git-sync');
    expect(repo.git('rev-list', '--count', '--left-right', 'HEAD...@{upstream}').trim()).toBe('1\t1');

    await openGitPanel(page, server, repo);

    // The badge is what the panel knows about the divergence; the button is
    // enabled (only a running action disables it) and named by its ACTION.
    await expect(page.getByText('↑1 ↓1')).toBeVisible();
    const sync = page.getByRole('button', { name: 'Sync with upstream' });
    await expect(sync).toBeEnabled();
    await sync.click();

    await waitUntil(async () =>
      repo.git('rev-list', '--count', '--left-right', 'HEAD...@{upstream}').trim() === '0\t0',
    );
    // Both sides landed and the history records a real merge.
    expect(repo.git('log', '-1', '--pretty=%s')).toContain('Merge branch');
    expect(repo.git('status', '--porcelain=v1').trim()).toBe('');
  });
});

test.describe('Source Control — commit history graph alignment', () => {
  /**
   * A repository with `count` commits.
   *
   * `bodies: true` gives every commit a multi-line body, so a row has something
   * to expand; `bodies: false` gives one-line subjects, so a click only SELECTS.
   *
   * The distinction is load-bearing for the spec, not decoration. Selecting a
   * row moves the action strip from the previous selection to the new one, so
   * one row grows by the strip's height while another shrinks by exactly the
   * same — a NET-ZERO change to the container's height, which is the state that
   * used to leave every node at its pre-click `y`. A commit with a body ALSO
   * expands on that same click, which grows the container and re-triggers the
   * measurement by itself: a fixture of multi-line commits therefore hides the
   * bug it is meant to catch (measured — the first version of this spec passed
   * with the fix reverted for exactly that reason).
   */
  function seedHistoryRepo(name: string, count: number, options: { bodies: boolean }): SeedWorkingRepo {
    const repo = makeRepo(name);
    for (let i = 0; i < count; i++) {
      writeFileSync(join(repo.path, `f${i}.txt`), `content ${i}\n`);
      repo.git('add', '-A');
      repo.git(
        'commit',
        '-q',
        '-m',
        `subject ${i}`,
        ...(options.bodies ? ['-m', `body line one for ${i}\nbody line two for ${i}`] : []),
      );
    }
    return repo;
  }

  /** Open the commit history modal and wait for its rows. */
  async function openHistory(page: Page, server: HarnessServer, repo: SeedWorkingRepo): Promise<void> {
    await openGitPanel(page, server, repo);
    await page.getByRole('button', { name: 'Commit History', exact: true }).click();
    await expect(page.getByRole('dialog').locator('[data-testid="commit-row"]').first()).toBeVisible();
  }

  /**
   * The vertical distance between each row's SUBJECT LINE and its graph node.
   *
   * Both are read in viewport coordinates through `getBoundingClientRect`, so
   * the comparison needs no knowledge of the scroller's own offset — which is
   * the point: the panel computes the node position by subtracting the
   * container rect and adding `scrollTop`, and a bug in that arithmetic is
   * exactly what this catches.
   *
   * A node is matched to its row by HASH (`data-commit-node` /
   * `data-commit-hash`), never by index: the two lists are built from the same
   * array today, and an index match would silently pair the wrong two the day
   * one of them filters.
   */
  async function nodeTitleOffsets(page: Page): Promise<Array<{ hash: string; delta: number }>> {
    return page.getByRole('dialog').evaluate((dialog) => {
      const rows = Array.from(dialog.querySelectorAll<HTMLElement>('[data-testid="commit-row"]'));
      const offsets: Array<{ hash: string; delta: number }> = [];
      for (const row of rows) {
        const hash = row.dataset.commitHash ?? '';
        const node = dialog.querySelector<SVGGraphicsElement>(`[data-commit-node="${hash}"] [data-commit-dot]`);
        const title = row.querySelector<HTMLElement>('[data-commit-title]');
        if (!node || !title) continue;
        const nodeRect = node.getBoundingClientRect();
        const titleRect = title.getBoundingClientRect();
        offsets.push({
          hash: hash.slice(0, 8),
          delta: nodeRect.top + nodeRect.height / 2 - (titleRect.top + titleRect.height / 2),
        });
      }
      return offsets;
    });
  }

  /** Every row's node must sit on its subject line. */
  async function expectNodesOnTitles(page: Page, context: string): Promise<void> {
    // Let the measurement settle. The panel re-measures in a layout effect and
    // again on the next frame, so the invariant holds within a frame or two of
    // any change — but this assertion is about the STATE, not the timing, so it
    // reads after the row's own transition has landed rather than racing it.
    await page.waitForTimeout(400);
    const offsets = await nodeTitleOffsets(page);
    expect(offsets.length).toBeGreaterThan(4);
    const drifted = offsets.filter((row) => Math.abs(row.delta) > 1);
    expect(drifted, `${context}: node off its subject line — ${JSON.stringify(drifted)}`).toEqual([]);
  }

  test('a selected commit keeps its node on its own title line', async ({ harness, page }) => {
    const server = await harness('real');
    // ONE-LINE commits on purpose: a click then only SELECTS, which moves the
    // action strip between rows and leaves the container's total height
    // unchanged. With a body on every commit the same click also expands, the
    // container grows, and the measurement re-fires by itself — see
    // `seedHistoryRepo` for why that would hide the bug.
    const repo = seedHistoryRepo('git-graph-select', 12, { bodies: false });
    await openHistory(page, server, repo);

    // Baseline: the first row is selected on open (the panel seeds the
    // selection from the first commit), and every node sits on its title.
    await expectNodesOnTitles(page, 'initial');

    // Selecting MOVES the rows: the action strip renders under the newly
    // selected row's subject line and leaves the previous one, so the rows
    // between them shift by that strip's height. The container's total height
    // is unchanged, which is why a container-only ResizeObserver never noticed
    // — measured, the node for the third row sat 48.5px below its title.
    for (const index of [3, 6, 1, 9]) {
      await page.getByRole('dialog').locator('[data-testid="commit-row"]').nth(index).click();
      await expectNodesOnTitles(page, `after selecting row ${index}`);
    }
  });

  test('an expanded commit body keeps every node on its title line', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = seedHistoryRepo('git-graph-expand', 12, { bodies: true });
    await openHistory(page, server, repo);

    // Expanding a body is a per-row growth with no matching shrink elsewhere —
    // a case the container observer DOES see. Pinned here because the two
    // mechanisms (the row observer, and re-measuring on the selection change)
    // must not be able to disagree about it.
    //
    // The subject is read OFF THE ROW rather than derived from the index: git
    // logs newest-first, so `nth(4)` is not `subject 4`, and a spec that
    // assumed the ordering would assert against a body that is not there.
    const row = page.getByRole('dialog').locator('[data-testid="commit-row"]').nth(4);
    const subject = ((await row.locator('[data-commit-title]').textContent()) ?? '').trim();
    const index = subject.replace('subject ', '');
    expect(subject).toMatch(/^subject \d+$/);

    await row.click();
    await expect(row.getByText(`body line one for ${index}`)).toBeVisible();
    await expectNodesOnTitles(page, 'after expanding a body');

    await row.click();
    await expect(row.getByText(`body line one for ${index}`)).toBeHidden();
    await expectNodesOnTitles(page, 'after collapsing a body');
  });

  test('the graph view keeps its nodes on the title lines after a selection', async ({ harness, page }) => {
    const server = await harness('real');
    const repo = seedHistoryRepo('git-graph-mode', 12, { bodies: false });
    await openHistory(page, server, repo);

    // Graph mode draws the action strip on EVERY row (`isSelected || isGraphMode`),
    // so the row heights there are a different shape from History's — the mode
    // is a separate measurement, not a re-run of the same one.
    await page.getByRole('dialog').getByTitle('Graph view').click();
    await expectNodesOnTitles(page, 'graph mode, initial');

    await page.getByRole('dialog').locator('[data-testid="commit-row"]').nth(5).click();
    await expectNodesOnTitles(page, 'graph mode, after selecting row 5');
  });
});

test.describe('Source Control — repository management', () => {
  /**
   * The picker of the panel actually on screen.
   *
   * The desktop stack keeps every built-in view mounted and hides the inactive
   * ones with CSS, so the right panel holds ALL five pickers (files, search,
   * git, terminal, wiki) at once, each with the same `title`. `:visible` is what
   * selects the one the user is looking at — and it is also what makes this work
   * on the phone, whose drawer renders the same views without the desktop
   * panel's `data-panel-id` wrapper.
   */
  function visiblePicker(page: Page) {
    return page.locator('button[title="Switch git project"]:visible');
  }

  /**
   * A workspace that is a FOLDER OF REPOSITORIES, which is the shape the modal
   * exists for. `openGitPanel` binds a folder to one repo; here the folder is
   * the parent and three repos live under it.
   *
   * `mobile` opens the app at a phone viewport from the START and reaches the
   * panel through the drawer. Resizing a mounted desktop app is NOT the same
   * thing: the layout swap unmounts the right panel mid-flight, so the picker a
   * locator just resolved is detached before the click lands.
   */
  async function openNestedWorkspace(
    page: Page,
    server: HarnessServer,
    options: { mobile?: boolean } = {},
  ): Promise<{ parent: string; alpha: SeedWorkingRepo; conflicted: SeedWorkingRepo }> {
    const parent = await seedWorkspace(server, `e2e-repos-${Date.now()}`);
    scratch.push(parent);
    // The workspace dir `seedWorkspace` mints is the PARENT; each repo is a
    // child of it, so discovery finds them all under one root — the shape the
    // modal exists for.
    const alpha = seedWorkingRepoIn(join(parent.path, 'alpha'), 'alpha');
    const conflicted = seedWorkingRepoIn(join(parent.path, 'conflicted'), 'conflicted');
    scratch.push(alpha, conflicted);
    // Uncommitted work in `alpha` — a MODIFIED tracked file and an untracked
    // one, so a row's state badge exercises both numbers rather than one.
    writeFileSync(join(parent.path, 'alpha', 'f.txt'), 'modified\n');
    writeFileSync(join(parent.path, 'alpha', 'untracked.txt'), 'uncommitted\n');

    if (options.mobile) await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page, `${server.baseURL}/?folderId=${parent.id}`);
    if (options.mobile) {
      await expect(page.locator('[data-testid="app-root"]')).toBeVisible();
      await page.getByRole('button', { name: 'Open Right Panel' }).click();
      await page.locator('button[title="Source Control"]:visible').click();
    } else {
      await showSourceControl(page);
    }
    // Discovery runs in the background; the picker's own list is the gate. The
    // dropdown is toggled CLOSED after each read — it has no Escape handler, so
    // leaving it open would make the spec's own click close it instead of
    // opening it.
    await expect(visiblePicker(page)).toBeVisible();
    await expect.poll(async () => {
      await visiblePicker(page).click();
      const rows = await page.locator('div.absolute.top-full button').allTextContents();
      await visiblePicker(page).click();
      return rows.filter((row) => row.includes('alpha')).length;
    }).toBeGreaterThan(0);
    return { parent: parent.path, alpha, conflicted };
  }

  test('the modal lists every repo with its state, and switches the panel', async ({ harness, page }) => {
    const server = await harness('real');
    await openNestedWorkspace(page, server);

    await visiblePicker(page).click();
    await page.getByRole('button', { name: 'Manage repositories…' }).click();

    // The modal, by its own heading.
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    // The dropdown is gone: two lists at once is what closing it prevents.
    await expect(page.locator('input[title="Search repositories"]')).toBeHidden();

    // A row per discovered repo, each naming its branch.
    const rows = dialog.locator('[title^="Show "], [title^="Already showing"]');
    await expect(rows.first()).toBeVisible();
    await expect(rows.filter({ hasText: 'alpha' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'conflicted' })).toHaveCount(1);
    // The dirty repo says so — the whole reason a modal beats a dropdown.
    await expect(dialog.getByTitle('1 changed, 1 untracked')).toBeVisible();
    // A clean repo says so explicitly rather than showing an empty strip.
    await expect(dialog.getByTitle('Nothing to report — clean and in sync').first()).toBeVisible();

    // Switching from the modal closes it and moves the panel.
    //
    // The row clicked is the one that is NOT currently showing — `Show <path>`
    // is only its title while it is not the active repo, and the active row's
    // button is `disabled`. Which repo leads is discovery's business (the list
    // is sorted, so `alpha` does), and asserting `Show alpha` here made this
    // spec depend on the panel having defaulted to the OTHER one: true while
    // `readdir` order happened to put `conflicted` first, false once the list
    // was sorted — and false in CI on the commit that added the modal.
    const otherRow = dialog.locator('[title^="Show "]');
    await expect(otherRow).toHaveCount(1);
    const otherName = (await otherRow.textContent())?.trim() ?? '';
    await otherRow.click();
    await expect(dialog).toBeHidden();
    await expect(visiblePicker(page)).toContainText(otherName);
  });

  test('the modal rows fit a phone, where the dropdown columns would not', async ({ harness, page }) => {
    const server = await harness('real');
    await openNestedWorkspace(page, server, { mobile: true });

    await visiblePicker(page).click();
    await page.getByRole('button', { name: 'Manage repositories…' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Repositories' })).toBeVisible();
    // The rows come from a per-repo read; wait for one before measuring, or the
    // measurement lands on the loading state.
    await expect(dialog.locator('[title^="Show "], [title^="Already showing"]').first()).toBeVisible();

    // The row grid must not overflow its scroller, and the NAME must keep real
    // width. The first shape was five fixed columns totalling 384px of a 358px
    // dialog, which collapsed the name track to zero — invisible to any unit
    // test and measured only in a browser.
    const measured = await dialog.evaluate((node) => {
      const scroller = node.querySelector('.scrollbar-overlay-container') as HTMLElement;
      const showBtn = node.querySelector('[title^="Show "]') as HTMLElement;
      const nameSpan = showBtn?.querySelector('span') as HTMLElement | null;
      return {
        scrollerOverflow: scroller.scrollWidth - scroller.clientWidth,
        nameWidth: nameSpan?.getBoundingClientRect().width ?? 0,
        docOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(measured.scrollerOverflow).toBeLessThanOrEqual(0);
    expect(measured.docOverflow).toBeLessThanOrEqual(0);
    // A name track crushed to zero is the failure this pins. The threshold is
    // generous on purpose: `alpha` measures 31px in the 12px face, so anything
    // above zero would pass — but a broken track measures exactly 0.
    expect(measured.nameWidth).toBeGreaterThan(20);
  });
});

/**
 * A folder that is not a repository.
 *
 * The panel used to draw its whole chrome here — branch toolbar, commit box,
 * "No changes found." — over a directory where every one of those controls
 * answered `fatal: not a git repository`; only the repo dropdown did anything,
 * which is the reported "the git panel has no function, only the dropdown
 * works". It now reports the folder and offers the one action that changes that.
 *
 * The click is proved by GIT, not by the panel's own state: `.git` exists on
 * disk, and the chrome the panel stopped drawing is back — which can only happen
 * if the status read now reports a working tree.
 */
test.describe('Source Control — a folder that is not a repository', () => {
  test('offers Initialize, and the click creates the repository', async ({ harness, page }) => {
    const server = await harness('real');
    // `seedWorkspace` binds a fresh temp directory, which is outside every
    // repository — exactly the state the panel answers with `isRepo: false`.
    const workspace = await seedWorkspace(server, `e2e-git-plain-${Date.now()}`);
    scratch.push(workspace);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await showSourceControl(page);

    await expect(page.getByRole('button', { name: 'Initialize Git repository' })).toBeVisible();
    // The dead panel is GONE, not merely empty.
    await expect(page.getByPlaceholder(/commit message/i)).toHaveCount(0);
    await expect(page.getByText('No changes found.')).toHaveCount(0);

    await page.getByRole('button', { name: 'Initialize Git repository' }).click();

    // The commit box returns once the status read reports a repository...
    await expect(page.getByPlaceholder(/commit message/i)).toBeVisible({ timeout: 20_000 });
    // ...and that answer is git's, not the panel's: the repository is on disk.
    await waitUntil(async () => existsSync(join(workspace.path, '.git')));
  });
});

/** A FormData body for the git route, as the panel submits it. */
function formBody(fields: Record<string, string>): FormData {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}


