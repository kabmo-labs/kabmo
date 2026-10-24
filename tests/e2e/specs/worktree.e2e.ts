/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A chat that runs in a git worktree, from the composer to the sidebar chip.
 *
 * Three things here are only true of the assembled product, and each was a
 * plausible-looking implementation that failed in the browser:
 *
 * - **The picker creates a real worktree.** It goes through `POST /api/worktrees`
 *   and the answer is checked against `GET /api/worktrees`, so a route that
 *   answered success while writing nothing cannot pass.
 * - **The worktree control is its own dropdown.** The composer draws the
 *   workspace (which project) and the worktree (which checkout of it) as two
 *   controls; a spec that addresses one trigger for both is the merged menu
 *   coming back.
 * - **The send SPAWNS in the worktree.** The chip under the session's row is
 *   derived from that session's own cwd (`worktreeForCwd`), so it appears only if
 *   the child was born there — a client-side pick that never reached the send
 *   path renders the trigger's words and nothing else.
 * - **The dialog's refusal is inline.** The server's own `code`/`field` is what
 *   the form marks, so a branch git already holds has to be reported without
 *   closing the dialog.
 *
 * `real` mode: the feature shells out to `git`, and the fake `omp` the harness
 * installs is what makes the spawn observable without a model.
 */

import { writeFileSync } from 'node:fs';
import { test, expect, openApp } from '../fixtures/app';
import { seedRepoWorkspace } from '../fixtures/repo-workspace';

interface WorktreeRow {
  path: string;
  branch: string;
  isPrimary: boolean;
  dirty: number;
  sessions: number;
}

async function listWorktrees(baseURL: string, root: string): Promise<WorktreeRow[]> {
  const response = await fetch(`${baseURL}/api/worktrees?root=${encodeURIComponent(root)}`);
  const payload = (await response.json()) as { worktrees?: WorktreeRow[] };
  return payload.worktrees ?? [];
}

test.describe('worktree', () => {
  test('quick worktree: the picker creates one and the send runs inside it', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedRepoWorkspace(server, 'e2e-worktree-quick');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // Two controls, two questions: the workspace names the project, the
    // worktree names the checkout inside it. The worktree control is where a
    // worktree is made, and it is its own dropdown.
    const workspacePicker = page.getByRole('button', { name: 'Workspace: e2e-worktree-quick' }).first();
    await expect(workspacePicker).toBeVisible();

    const worktreePicker = page.getByRole('button', { name: /^Worktree: / }).first();
    await expect(worktreePicker).toBeVisible();
    // The root's own branch, read on mount: the trigger says where the chat
    // would run before the menu is ever opened.
    await expect(worktreePicker).toHaveAccessibleName('Worktree: main');
    await worktreePicker.click();

    // The menu rows carry `menuitem`, so the role is what proves the control is
    // reachable by keyboard rather than a clickable div.
    await page.getByRole('menuitem', { name: /Quick worktree/ }).first().click();

    // The WORKTREE trigger now names the worktree, and the workspace trigger is
    // untouched — the pick moved one half of the target, not both.
    const trigger = page.getByRole('button', { name: /^Worktree: wt\// }).first();
    await expect(trigger).toBeVisible({ timeout: 20_000 });
    await expect(workspacePicker).toHaveAccessibleName('Workspace: e2e-worktree-quick');

    // A worktree really exists on disk, and it is not the checkout.
    const created = await listWorktrees(server.baseURL, workspace.path);
    const made = created.find((entry) => !entry.isPrimary);
    expect(made, 'the picker created no worktree').toBeDefined();
    expect(made?.branch).toMatch(/^wt\//);
    // The ignored build folder came with it: a worktree that cannot run is not
    // a worktree, and git alone never copies one.
    const carried = await fetch(
      `${server.baseURL}/api/fs/dir?root=${encodeURIComponent(workspace.path)}&path=node_modules`,
    );
    expect(carried.status).toBe(200);

    // Send, and wait for the run to land. The fake child answers the prompt.
    const input = page.locator('[data-testid="composer-input"]');
    await expect(input).toBeVisible();
    await input.fill('where am I');
    await input.press('Enter');
    await expect(page.getByText('Response to: where am I').first()).toBeVisible({ timeout: 30_000 });

    // The chip is derived from the SESSION's cwd, so it is the proof the spawn
    // used the worktree rather than the project root.
    // The row's chip is derived from the SCANNED transcript, which lags the
    // stream: omp writes the session file as the run proceeds and the sidebar
    // re-scans on the turn boundary. Poll the payload the sidebar reads, so the
    // assertion waits on the fact rather than on a duration.
    await expect
      .poll(
        async () => {
          const listed = await listWorktrees(server.baseURL, workspace.path);
          return listed.find((entry) => entry.path === made?.path)?.sessions ?? 0;
        },
        { timeout: 30_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBeGreaterThan(0);

    const chip = page.locator('[data-worktree-status]').first();
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText('wt/');

    workspace.dispose();
  });

  test('the dialog creates a named worktree and reports a taken branch inline', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedRepoWorkspace(server, 'e2e-worktree-dialog');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    const worktreePicker = page.getByRole('button', { name: /^Worktree: / }).first();
    await expect(worktreePicker).toBeVisible();
    await worktreePicker.click();
    await page.getByRole('menuitem', { name: /New worktree/ }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // `main` is checked out in the primary worktree, so git refuses a second
    // checkout of it — and the refusal has to name the branch, not "failed".
    const branch = dialog.getByRole('textbox').first();
    await branch.fill('main');
    await dialog.getByRole('button', { name: /Create worktree/ }).click();

    await expect(dialog.getByText(/already checked out|already exists/i)).toBeVisible({ timeout: 20_000 });
    // A refusal that closed the dialog would read as success.
    await expect(dialog).toBeVisible();

    // A name nobody holds goes through, and the dialog closes.
    await branch.fill('wt/e2e-dialog-made');
    await dialog.getByRole('button', { name: /Create worktree/ }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const listed = await listWorktrees(server.baseURL, workspace.path);
    expect(listed.some((entry) => entry.branch === 'wt/e2e-dialog-made')).toBe(true);

    // The worktree control adopted it, so the draft runs there.
    await expect(page.getByRole('button', { name: 'Worktree: wt/e2e-dialog-made' }).first()).toBeVisible({
      timeout: 20_000,
    });

    workspace.dispose();
  });

  test('a dirty worktree is refused with its count, and nothing is removed', async ({ harness }) => {
    const server = await harness('real');
    const workspace = await seedRepoWorkspace(server, 'e2e-worktree-dirty');

    // Created through the real route, the way the picker does it.
    const created = await fetch(`${server.baseURL}/api/worktrees?root=${encodeURIComponent(workspace.path)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'new', branch: 'wt/e2e-dirty' }),
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { worktree: { path: string } };

    // Leave work behind in it.
    // `node:fs`, not `Bun.write`: this layer runs in a Playwright WORKER, which
    // is Node, so a Bun global is a ReferenceError here.
    writeFileSync(`${createdBody.worktree.path}/scratch.txt`, 'not committed\n');

    const listed = await listWorktrees(server.baseURL, workspace.path);
    const row = listed.find((entry) => entry.branch === 'wt/e2e-dirty');
    expect(row?.dirty).toBeGreaterThan(0);

    // The route refuses with the count rather than deleting work.
    const refused = await fetch(`${server.baseURL}/api/worktrees?root=${encodeURIComponent(workspace.path)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: createdBody.worktree.path, deleteBranch: true }),
    });
    expect(refused.status).toBe(409);
    const refusal = (await refused.json()) as { code: string; count?: number };
    expect(refusal.code).toBe('dirty');
    expect(refusal.count).toBeGreaterThan(0);

    // Still there: a refusal is not a partial removal.
    expect((await listWorktrees(server.baseURL, workspace.path)).some((entry) => entry.branch === 'wt/e2e-dirty')).toBe(
      true,
    );

    workspace.dispose();
  });
});