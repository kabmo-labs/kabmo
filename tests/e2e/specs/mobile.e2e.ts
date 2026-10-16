/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone layout at a real phone viewport.
 *
 * `App` picks the mobile tree from a narrow viewport, a coarse pointer or a
 * mobile UA — and that decision is made once per load and can be overridden by
 * hand, which is exactly the kind of logic a unit test can call but cannot
 * prove renders. The bugs this class of spec catches are layout ones: a control
 * that only exists on the desktop tree, a drawer that opens behind the content,
 * a composer that cannot send without a hardware Enter key.
 *
 * Run under the `mobile-chromium` project (Pixel 7), so the viewport and the
 * `(pointer: coarse)` media query are the device's, not a resized desktop.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import { TESTID } from '../fixtures/selectors';

test.describe('mobile layout', () => {
  test('renders the mobile tree with its header controls', async ({ app }) => {
    // The header's own controls are the marker that the MOBILE tree mounted —
    // "Open Sessions" and "Open Right Panel" do not exist on the desktop tree.
    await expect(app.getByRole('button', { name: 'Open Sessions' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Open Right Panel' })).toBeVisible();
  });

  test('opens the sessions drawer', async ({ app }) => {
    await app.getByRole('button', { name: 'Open Sessions' }).click();
    // The drawer is the sidebar at phone width; the seeded demo folders are its
    // content, so their presence is the drawer being open and populated.
    await expect(app.getByRole('button', { name: /new session/i }).first()).toBeVisible();
  });

  /**
   * The Archive toggle is a standalone control, not a row inside the sort menu.
   *
   * It used to live in that dropdown under a "Filter" heading, which made a
   * view filter read as a sort mode and hid it one tap deeper than the control
   * that reorders the list. A unit test can assert the markup; only this layer
   * proves the button is on the phone's screen at all — the desktop toolbar has
   * an Archive glyph of its own, so a mobile tree that never rendered the
   * button would still pass a source-level check.
   */
  test('the archive toggle is its own control, not a sort-menu row', async ({ app }) => {
    await app.getByRole('button', { name: 'Open Sessions' }).click();

    const archive = app.getByRole('button', { name: 'Show archived sessions' });
    await expect(archive).toBeVisible();
    await expect(archive).toHaveAttribute('aria-pressed', 'false');

    // The sort menu carries the four sort options and nothing else.
    const sortTrigger = app.getByRole('button', { name: 'Sort workspaces' });
    await sortTrigger.click();
    const menu = app.locator('button[aria-label="Sort workspaces"] + div');
    await expect(menu.getByText('Sort Workspaces')).toBeVisible();
    await expect(menu.getByText('Show Archived')).toHaveCount(0);

    // Pick A-Z (the only sort the trigger does NOT highlight) so the baseline
    // is unambiguous, then compare the trigger's classes across the archive
    // click. They used to share one condition, so turning the filter on lit up
    // the sort button; with A-Z in force, any lighting is the archive's doing.
    await menu.getByText('A-Z', { exact: true }).click();
    await expect(menu).toHaveCount(0);
    const before = (await sortTrigger.getAttribute('class')) ?? '';
    expect(before).not.toContain('bg-ink/10');

    await archive.click();
    await expect(app.getByRole('button', { name: 'Hide archived sessions' })).toHaveAttribute('aria-pressed', 'true');
    expect((await sortTrigger.getAttribute('class')) ?? '').toBe(before);
  });

  test('a new chat shows its row in the drawer before it has a transcript', async ({ app }) => {
    // The phone never asked the controller for the pending placeholder, so a
    // brand-new chat had NO row in the drawer until omp's transcript scan
    // landed — the row appeared "after a while" with nothing explaining the gap.
    await app.getByRole('button', { name: 'Open Sessions' }).click();

    await app.getByRole('button', { name: 'New Session' }).first().click();
    const pendingId = new URL(app.url()).searchParams.get('sessionId') ?? '';
    expect(pendingId.startsWith('new-')).toBe(true);

    // The drawer closes on the click so the user lands on the chat; reopening it
    // is what a phone does to look at the list.
    await app.getByRole('button', { name: 'Open Sessions' }).click();
    await expect(
      app.locator(`[data-testid="session-item"][data-session-id="${pendingId}"]`),
    ).toBeVisible();
  });

  test('sends a prompt from the phone composer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-mobile').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();
    await input.fill('hello from the phone');
    // The phone variant makes a bare Enter insert a newline (no Shift key on a
    // soft keyboard), so the send control is the affordance a phone has.
    await page.getByRole('button', { name: /send message/i }).first().click();

    await expect(page.getByText('Response to: hello from the phone').first()).toBeVisible({ timeout: 30_000 });
    workspace.dispose();
  });

  /**
   * The phone boots the plugin system, which it did not.
   *
   * `PluginBootstrap` was mounted only by the desktop layout, so on a phone
   * `usePanelInfo()` answered the kit's module default (`sessionId: null`,
   * `workspacePath: null`) and no content script ever mounted — while plugin
   * PANELS still rendered, because the panel catalog loads bundles on its own.
   * A plugin therefore half worked with nothing on screen to explain it.
   *
   * The proof is a stylesheet `<link>`: `usePluginStylesheets` is called from
   * `PluginBootstrap` and nowhere else, and it loads a plugin's CSS only while
   * that plugin has a live content-script generation — so one `<link>` asserts
   * the bootstrap mounted, the content script mounted and the stylesheet was
   * reconciled. `session-info` is the fixture because it is the one bundled
   * plugin declaring BOTH a `contentScript` and a `css`.
   *
   * The mobile tree's own controls are asserted first: they do not exist on the
   * desktop tree, so a pass cannot be the desktop layout rendering.
   */
  test('boots the plugin system — context, content script and stylesheet', async ({ harness, page }) => {
    const server = await harness('real');

    // Through the real route, the same call the Panel Plugins pane makes. A
    // hand-copied directory would skip the build the route performs (measured:
    // 29ms for this plugin).
    const installed = await fetch(`${server.baseURL}/api/panels/install`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'install', pluginId: 'session-info' }),
    });
    expect(installed.ok).toBe(true);

    await openApp(page, server.baseURL);

    await expect(page.getByRole('button', { name: 'Open Sessions' })).toBeVisible();
    await expect(page.locator('link[data-plugin-stylesheet="session-info"]')).toHaveCount(1);
    // The surface the content script mounted into — what the plugin's own CSS
    // is scoped to.
    await expect(page.locator('[data-plugin-surface="session-info"]')).toHaveCount(1);
  });

  test('stretches the composer to the viewport and collapses on send', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-stretch');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-mobile-stretch').first()).toBeVisible();

    const card = () =>
      page.evaluate(() => {
        const input = document.querySelector('[data-testid="composer-input"]');
        if (!input) return null;
        const element = input.closest('div[class*="flex-col"]');
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          position: getComputedStyle(element).position,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        };
      });

    const docked = await card();
    expect(docked).not.toBeNull();
    expect(docked!.position).toBe('relative');
    expect(docked!.height).toBeLessThan(docked!.viewport.height);

    await page.getByRole('button', { name: /maximize composer/i }).click();
    await expect(page.getByRole('button', { name: /restore composer/i })).toHaveAttribute('aria-pressed', 'true');

    // The whole viewport, anchored at its origin. This is the assertion the
    // class list alone cannot make: `relative` in the base list outranks the
    // `fixed inset-0` that was added later, and the card stayed in the dock.
    const stretched = await card();
    expect(stretched!.position).toBe('fixed');
    expect(stretched!.x).toBe(0);
    expect(stretched!.y).toBe(0);
    expect(stretched!.width).toBe(stretched!.viewport.width);
    expect(stretched!.height).toBe(stretched!.viewport.height);

    // Sending returns to the dock: the stretched composer covers the
    // transcript, so staying open would hide the answer being streamed.
    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill('stretch and send');
    await page.getByRole('button', { name: /send message/i }).first().click();

    await expect(page.getByText('Response to: stretch and send').first()).toBeVisible({ timeout: 30_000 });
    const afterSend = await card();
    expect(afterSend!.position).toBe('relative');

    workspace.dispose();
  });
});
