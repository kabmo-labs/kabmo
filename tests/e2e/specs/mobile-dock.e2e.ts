/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The phone's LEFT dock.
 *
 * The desktop's left column is a dock: the session list plus whatever plugin
 * panel the user placed beside it, switched by a vertical rail. A phone had no
 * equivalent — the drawer was the session list and nothing else — so a panel
 * placed on the left was invisible on every phone, and the Settings switch that
 * says "Show the left activity bar" changed a stored value that no phone surface
 * read.
 *
 * The strip is the same horizontal chip bar the right drawer uses, so the two
 * cannot disagree about label, active state or order. Every assertion below is
 * something a unit test cannot see: the catalog is a realtime read, the plugin
 * bundle is a real build, and the two drawers' contents are a property of the
 * live catalog rather than of a fixture.
 *
 * `real` mode, because a bundled plugin has to be installed and BUILT for its
 * panel to exist — the mock dataset ships plugins but no runnable bundles.
 */

import type { Page } from '@playwright/test';
import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import type { HarnessServer } from '../fixtures/server';

/** The bundled plugin this spec places on the left rail. */
const PLUGIN_ID = 'stats';
/** Its `rightPanel` registration, as the dock stores an instance key. */
const PANEL_KEY = `plugin:${PLUGIN_ID}:rightPanel`;
/** The view's own title — the chip's tooltip is `<title> — <plugin name>`. */
const PANEL_TITLE = 'Resources — stats';

/**
 * Install the bundled plugin and place it on the LEFT rail, through the real
 * routes.
 *
 * A hand-written settings row would skip the scan and the placement rules; the
 * routes are what a user's own clicks hit, and the placement has to be read back
 * by the catalog the drawers render.
 */
async function installAndPlaceLeft(server: HarnessServer): Promise<void> {
  const install = await fetch(`${server.baseURL}/api/panels/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'install', pluginId: PLUGIN_ID }),
  });
  expect(install.ok, await install.clone().text()).toBe(true);

  const place = await fetch(`${server.baseURL}/api/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ omp_left_panels: { enabled: true, panels: [PANEL_KEY] } }),
  });
  expect(place.ok, await place.clone().text()).toBe(true);
}

/** The phone's session drawer, opened from the header. */
async function openSessions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open Sessions' }).click();
}

test.describe('mobile left dock', () => {
  test('draws a placed panel as a chip beside Sessions, and switches to it', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock');
    await installAndPlaceLeft(server);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openSessions(page);

    // The strip exists because there is something to switch TO. Before this
    // feature the drawer drew neither chip and the placement was unreachable.
    const sessionsChip = page.getByRole('button', { name: 'Sessions', exact: true });
    const panelChip = page.getByRole('button', { name: PANEL_TITLE });
    await expect(sessionsChip).toBeVisible();
    await expect(panelChip).toBeVisible();
    // The session list is what it opened on.
    await expect(sessionsChip).toHaveAttribute('aria-pressed', 'true');

    await panelChip.click();
    await expect(panelChip).toHaveAttribute('aria-pressed', 'true');
    // The plugin's own body, drawn from its real bundle.
    await expect(page.getByText('Stats', { exact: true }).first()).toBeVisible();

    // Back to the list. The drawer swaps bodies rather than stacking them, so
    // this is also the assertion that the strip is a switch and not a one-way
    // door.
    await sessionsChip.click();
    await expect(page.getByRole('button', { name: /new session/i }).first()).toBeVisible();

    workspace.dispose();
  });

  test('with the rail ON and nothing placed, the drawer still draws its rail', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-empty');
    // The switch on its own, with no plugin placed on the left: the state a
    // user reaches by turning "Show the left activity bar" on and nothing else.
    // Before the strip followed the switch, this drawer drew NO chip — the
    // switch changed a boolean and nothing on screen, which reads as broken.
    await fetch(`${server.baseURL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ omp_left_panels: { enabled: true, panels: [] } }),
    });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await openSessions(page);

    // One chip, and it is the session list — the same picture the desktop
    // column's rail draws when the dock holds only its own view.
    const sessionsChip = page.getByRole('button', { name: 'Sessions', exact: true });
    await expect(sessionsChip).toBeVisible();
    await expect(sessionsChip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: /new session/i }).first()).toBeVisible();

    workspace.dispose();
  });

  test('a panel placed on the left is not drawn on the right drawer too', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-split');
    await installAndPlaceLeft(server);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    // With the rail ON the left drawer owns the panel, so the right drawer must
    // not offer a second chip for it — one panel, one place to be.
    await page.getByRole('button', { name: 'Open Right Panel' }).click();
    await expect(page.getByRole('button', { name: PANEL_TITLE })).toHaveCount(0);
    // A right-column view is still there, which is what proves the filter is
    // about the placement and not about the plugin.
    await expect(page.getByRole('button', { name: 'Files' })).toBeVisible();

    workspace.dispose();
  });

  test('with the rail OFF the right drawer still reaches a left-placed panel', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-off');
    await installAndPlaceLeft(server);
    // Turn the rail back off, leaving the placement in place: the left drawer
    // then has no strip, and hiding the panel from both would make a placement
    // look like an uninstall.
    await fetch(`${server.baseURL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ omp_left_panels: { enabled: false } }),
    });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);

    await openSessions(page);
    // No rail, no strip: the drawer is the plain session list again.
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /new session/i }).first()).toBeVisible();

    // …and the panel is still reachable, from the RIGHT drawer.
    await page.getByRole('button', { name: 'Close sidebar' }).click();
    await page.getByRole('button', { name: 'Open Right Panel' }).click();
    await expect(page.getByRole('button', { name: PANEL_TITLE })).toBeVisible();

    workspace.dispose();
  });
});
