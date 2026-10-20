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
import { expectIndicatorSurvivesLongPhrase } from '../fixtures/indicator';

test.describe('mobile layout', () => {
  test('renders the mobile tree with its header controls', async ({ app }) => {
    // The header's own controls are the marker that the MOBILE tree mounted —
    // "Open Sessions" and "Open Right Panel" do not exist on the desktop tree.
    await expect(app.getByRole('button', { name: 'Open Sessions' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Open Right Panel' })).toBeVisible();
    // Reload is the desktop navbar's control too, so a phone that never drew it
    // would pass every other assertion here — the label is the one thing both
    // layouts share.
    await expect(app.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });

  /**
   * The session picker and the reload control must never touch.
   *
   * The header's left group was `min-w-0` but not `flex-1`, so it kept its
   * max-content width: the picker's `<button>` carried `max-w-[150px]` and
   * stayed at 150px while its wrapper shrank, spilling the title over the
   * control cluster — measured at 320px the picker's right edge and the reload
   * button's left edge were the SAME pixel, and at 375/360 the title's box
   * covered the reload control by 15/30px. A class list cannot prove that; only
   * a browser resolving the flex layout can.
   *
   * The worst case is forced here (a long title written into the picker), since
   * the mock's own titles are short enough to hide the overlap.
   */
  test('the session title never reaches the reload control', async ({ app }) => {
    await app.setViewportSize({ width: 320, height: 800 });

    const geometry = () =>
      app.evaluate(() => {
        const header = document.querySelector('header')!;
        const picker = header.querySelector('[data-testid="session-picker"] button') as HTMLElement | null;
        const reload = header.querySelector('button[aria-label="Reload page"]') as HTMLElement | null;
        const label = picker?.querySelector('span') ?? null;
        if (!picker || !reload || !label) return null;
        const pickerBox = picker.getBoundingClientRect();
        const reloadBox = reload.getBoundingClientRect();
        return {
          gap: Math.round(reloadBox.left - pickerBox.right),
          titleClipped: label.scrollWidth > label.clientWidth,
          viewportWidth: window.innerWidth,
          documentWidth: document.documentElement.scrollWidth,
        };
      });

    const short = await geometry();
    expect(short).not.toBeNull();
    expect(short!.gap).toBeGreaterThanOrEqual(4);
    expect(short!.documentWidth).toBe(short!.viewportWidth);

    await app.evaluate(() => {
      const picker = document.querySelector('[data-testid="session-picker"] button')!;
      picker.querySelector('span')!.textContent =
        'Fix flaky park tests for the payments service integration suite';
    });

    const long = await geometry();
    expect(long!.gap).toBeGreaterThanOrEqual(4);
    // The title gives up the width instead of pushing the controls: it ends in
    // an ellipsis and the header still fits the viewport.
    expect(long!.titleClipped).toBe(true);
    expect(long!.documentWidth).toBe(long!.viewportWidth);
  });

  /**
   * With a password set, the lock joins the cluster and the title keeps working.
   *
   * The cluster is 140px wide with the lock (reload, context, sign out, panel)
   * against 104px without, and the left group also carries 73px of fixed chrome
   * (hamburger, wordmark, slash). On a 390px phone that left the title 89px —
   * one and a half words — and at 320px it left 19px, which is not a title at
   * all. The wordmark and its slash are therefore dropped below 420px; the
   * brand is still drawn by the drawer's own header and by the desktop navbar.
   *
   * The threshold is measured, not guessed: at 420px the picker gets 136px with
   * the brand present, and below it the brand's 73px is worth more to the title
   * than the logo is. The spec asserts BOTH sides of the boundary, because a
   * brand hidden at every width would pass the narrow half alone.
   */
  test.describe('with a UI password', () => {
    test.use({ serverEnv: { KABMO_UI_PASSWORD: 'e2e-password' } });

    test('the header keeps the title readable beside the lock', async ({ harness, page }) => {
      const server = await harness('mock');
      await openApp(page, server.baseURL);
      // The login screen is the app shell at the served URL; the session is
      // obtained in-page so the cookie belongs to this browser context.
      await page.evaluate(async () => {
        await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: 'e2e-password', remember: false }),
        });
      });
      await page.goto(server.baseURL, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

      const measure = () =>
        page.evaluate(() => {
          const header = document.querySelector('header')!;
          const picker = header.querySelector('[data-testid="session-picker"] button') as HTMLElement;
          const label = picker.querySelector('span') as HTMLElement;
          const controls = header.querySelector(':scope > div:nth-child(2)') as HTMLElement;
          const brand = header.querySelector('span.relative') as HTMLElement | null;
          return {
            brandShown: brand ? getComputedStyle(brand).display !== 'none' : false,
            titleWidth: Math.round(label.getBoundingClientRect().width),
            gap: Math.round(controls.getBoundingClientRect().left - picker.getBoundingClientRect().right),
            documentWidth: document.documentElement.scrollWidth,
          };
        });

      await page.setViewportSize({ width: 360, height: 800 });
      const narrow = await measure();
      expect(narrow.brandShown).toBe(false);
      expect(narrow.gap).toBeGreaterThanOrEqual(4);
      // The title is the widest thing the left group can offer once the brand is
      // gone: measured 74px here, against 59px with the wordmark present.
      expect(narrow.titleWidth).toBeGreaterThanOrEqual(70);
      expect(narrow.documentWidth).toBe(360);

      await page.setViewportSize({ width: 520, height: 800 });
      const wide = await measure();
      expect(wide.brandShown).toBe(true);
      expect(wide.gap).toBeGreaterThanOrEqual(4);
      expect(wide.documentWidth).toBe(520);
    });
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
   * The phone is where the reported break was worst: a 412px viewport leaves
   * the docked indicator a little over 380px, so a real `bash` command is many
   * times the row. The verb must give up its width — ending in an ellipsis —
   * and the provider, the model and the loading dots must all stay on screen.
   * Measured in the browser because a class list proves nothing about which
   * member flexbox actually shrank.
   */
  test('keeps the provider, model and dots when the activity phrase is long', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-indicator');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-mobile-indicator').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await expect(input).toBeVisible();

    // Warm the session: the first prompt spawns the child, and the spawn path
    // republishes the session topic whose snapshot resets the phrase (see the
    // helper's note). A warm session keeps the tool's own phrase.
    await input.fill('warm up');
    await page.getByRole('button', { name: /send message/i }).first().click();
    await expect(page.getByText('Response to: warm up').first()).toBeVisible({ timeout: 30_000 });

    const command = 'rg -n --hidden --glob "!node_modules" "someVeryLongPatternThatKeepsGoing" src/client/components/workspace';
    await input.fill(`tool:bash cmd:${command} then answer`);
    await page.getByRole('button', { name: /send message/i }).first().click();

    await expectIndicatorSurvivesLongPhrase(page, command);

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
    // is scoped to. Scoped to the `<body>` child the host appends, because a
    // surface is no longer unique to the content script: `headerPanel` entries
    // render on the phone too (`f8c3f080`), and each trigger is wrapped in a
    // `PluginIdProvider` so the plugin's CSS can reach it. A bare count would
    // pass on the navbar trigger alone with no content script mounted at all —
    // the very failure this spec exists to catch.
    const surfaces = page.locator('body > [data-plugin-surface="session-info"]');
    await expect(surfaces).toHaveCount(1);
    // What the script appends into that surface, which is the other half: the
    // root can exist with nothing in it if the mount threw.
    await expect(surfaces.getByText('session info active')).toBeVisible();
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
