/**
 * @license
 * SPDX-License-Identifier: MIT
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

  /**
   * The navbar readout is the OTHER way a drawer's tab is chosen, and it is the
   * one that lands off-screen.
   *
   * A phone is too narrow to hold eleven chips, so the strip scrolls — with no
   * scrollbar to say so. Before the reveal, this click opened the drawer on the
   * right panel while its chip sat past the right edge: the panel rendered, and
   * nothing on screen named it or offered a way back to the others. Measured on
   * a Pixel 7, where the readout is folded into `⋯` and the panel's chip is the
   * last of twelve.
   */
  test('a panel opened from the navbar scrolls its chip into view', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-reveal');
    const install = await fetch(`${server.baseURL}/api/panels/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'install', pluginId: PLUGIN_ID }),
    });
    expect(install.ok, await install.clone().text()).toBe(true);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    // The row the readout folds into at this width. Its own title is the
    // accessible name, exactly as it is on the trigger it stands in for.
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Stats — CPU & RAM' }).click();

    const chip = page.getByRole('button', { name: PANEL_TITLE });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    // The panel itself, drawn from the real bundle.
    await expect(page.getByText('Stats', { exact: true }).first()).toBeVisible();

    // The assertion the defect fails: the chip is inside the strip's own box.
    // A `scrollLeft` check would pass on a strip that cannot scroll, so the
    // measurement is the chip's rect against the strip's.
    const fit = await chip.evaluate((element) => {
      const strip = element.parentElement as HTMLElement;
      const chipRect = element.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return {
        left: chipRect.left,
        right: chipRect.right,
        stripLeft: stripRect.left,
        stripRight: stripRect.right,
        scrollLeft: strip.scrollLeft,
        scrollable: strip.scrollWidth > strip.clientWidth,
      };
    });
    expect(fit.scrollable).toBe(true);
    expect(fit.scrollLeft).toBeGreaterThan(0);
    expect(fit.left).toBeGreaterThanOrEqual(fit.stripLeft - 1);
    expect(fit.right).toBeLessThanOrEqual(fit.stripRight + 1);

    workspace.dispose();
  });

  /**
   * The strip's WIDTH changes while it is open, which is the case the reveal
   * cannot handle from the selection alone.
   *
   * Rotating a phone (or a narrowed shell window) makes a strip that held every
   * chip overflow, and the active one — last in the catalog — is the first to
   * fall off the right edge. Nothing about the SELECTION changed, so a reveal
   * keyed only on it never runs and the drawer's own tab disappears.
   */
  test('narrowing the viewport keeps the active chip in view', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-narrow');
    await installAndPlaceLeft(server);
    await fetch(`${server.baseURL}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ omp_left_panels: { enabled: true, panels: [] } }),
    });

    // Wide enough for the whole strip, and still below the 768px layout
    // breakpoint so the phone tree is what is under test.
    await page.setViewportSize({ width: 740, height: 900 });
    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Open Right Panel' }).click();

    const chip = page.getByRole('button', { name: PANEL_TITLE });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    const wide = await chip.evaluate((element) => (element.parentElement as HTMLElement).scrollWidth <= (element.parentElement as HTMLElement).clientWidth);
    expect(wide).toBe(true);

    await page.setViewportSize({ width: 412, height: 900 });
    const fit = await chip.evaluate((element) => {
      const strip = element.parentElement as HTMLElement;
      const chipRect = element.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return { left: chipRect.left, right: chipRect.right, stripLeft: stripRect.left, stripRight: stripRect.right };
    });
    expect(fit.left).toBeGreaterThanOrEqual(fit.stripLeft - 1);
    expect(fit.right).toBeLessThanOrEqual(fit.stripRight + 1);

    workspace.dispose();
  });

  /**
   * The LEFT drawer is the harder half of the same reveal, because it is
   * mounted permanently and hidden with `display: none` — a box with no width
   * has nothing to scroll. The navbar click that selects a left-placed panel
   * also switches the screen, so the strip becomes measurable in the SAME
   * render; the reveal must therefore not be a one-shot on mount.
   */
  test('a panel opened from the navbar scrolls its chip into view on the left drawer', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-dock-reveal-left');
    await installAndPlaceLeft(server);

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Stats — CPU & RAM' }).click();

    // The click lands on the SESSION screen, because that is the drawer that
    // holds the chip — and the chip is the panel it asked for.
    const chip = page.getByRole('button', { name: PANEL_TITLE });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Sessions', exact: true })).toBeVisible();

    const fit = await chip.evaluate((element) => {
      const strip = element.parentElement as HTMLElement;
      const chipRect = element.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return {
        visible: stripRect.width > 0,
        left: chipRect.left,
        right: chipRect.right,
        stripLeft: stripRect.left,
        stripRight: stripRect.right,
        scrollLeft: strip.scrollLeft,
      };
    });
    expect(fit.visible).toBe(true);
    expect(fit.left).toBeGreaterThanOrEqual(fit.stripLeft - 1);
    expect(fit.right).toBeLessThanOrEqual(fit.stripRight + 1);

    // …and again after a reload, which is the case a one-shot reveal misses:
    // the drawer is mounted HIDDEN (the phone opens on the chat), so its strip
    // measures zero wide when the stored tab is restored. The reveal has to run
    // when the box gains a width, not only when the selection changes.
    //
    // The tab write is debounced, so the reload waits for the state POST rather
    // than guessing a duration — without this the reload reads the previous
    // blob back and the chip is correctly not pressed.
    await page.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/state'),
    );
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The chip is waited for as an ELEMENT, not a role: the drawer is mounted
    // hidden, and a role locator excludes anything outside the accessibility
    // tree. This is the state a one-shot reveal cannot handle — a box with no
    // width has nothing to scroll — so the reveal has to run when the drawer
    // gains its width, not only when the selection changes.
    const hidden = page.locator(`button[aria-label="${PANEL_TITLE}" i]`);
    await expect(hidden).toBeAttached();
    await expect(hidden).toHaveAttribute('aria-pressed', 'true');
    await openSessions(page);
    const reopened = page.getByRole('button', { name: PANEL_TITLE });
    await expect(reopened).toBeVisible();
    const afterReload = await reopened.evaluate((element) => {
      const strip = element.parentElement as HTMLElement;
      const chipRect = element.getBoundingClientRect();
      const stripRect = strip.getBoundingClientRect();
      return { left: chipRect.left, right: chipRect.right, stripLeft: stripRect.left, stripRight: stripRect.right };
    });
    expect(afterReload.left).toBeGreaterThanOrEqual(afterReload.stripLeft - 1);
    expect(afterReload.right).toBeLessThanOrEqual(afterReload.stripRight + 1);

    workspace.dispose();
  });
});
