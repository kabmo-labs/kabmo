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
    await expect(app.getByRole('button', { name: 'Context usage' })).toBeVisible();
    // Pixel 7 is 412px, past the 400px fold threshold for an open instance, so
    // the row holds every control and there is no `⋯`. The narrow case is its
    // own spec below.
    await expect(app.getByRole('button', { name: 'Reload page' })).toBeVisible();
  });

  test('keeps reload one click away behind the ⋯ menu on a narrow phone', async ({ app }) => {
    // 360px is below the fold threshold, so the two rare controls move into the
    // menu rather than truncating the session title to pay for them.
    await app.setViewportSize({ width: 360, height: 800 });
    const trigger = app.getByRole('button', { name: 'More actions' });
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();

    const menu = app.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Reload page' })).toBeVisible();

    // Escape closes it, so a menu opened by accident is not a trap.
    await app.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * A phone wide enough for the row draws EVERY control, and no menu.
   *
   * The fold is a width, not a device class: `MOBILE_FULL_ROW_PX` is the
   * narrowest header that still fits the whole cluster beside a full-width
   * session picker, and past it there is nothing to gain by hiding a control.
   * A layout that folded unconditionally would pass every narrow spec and still
   * be wrong here — which is why this case exists.
   */
  test('a wide phone draws the full row instead of the ⋯ menu', async ({ app }) => {
    await app.setViewportSize({ width: 560, height: 900 });
    // Let the media query settle; `useViewportAtLeast` subscribes to it.
    await expect(app.getByRole('button', { name: 'Reload page' })).toBeVisible();

    await expect(app.getByRole('button', { name: 'Context usage' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'Open Right Panel' })).toBeVisible();
    await expect(app.getByRole('button', { name: 'More actions' })).toHaveCount(0);
  });

  /**
   * The session picker must never reach the control cluster.
   *
   * The header's left group was `min-w-0` but not `flex-1`, so it kept its
   * max-content width: the picker's `<button>` carried `max-w-[150px]` and
   * stayed at 150px while its wrapper shrank, spilling the title over the
   * controls — measured at 320px the picker's right edge and the first
   * control's left edge were the SAME pixel, and at 375/360 the title's box
   * covered it by 15/30px. A class list cannot prove that; only a browser
   * resolving the flex layout can.
   *
   * The cluster's FIRST control is measured rather than reload specifically:
   * reload has since moved into the `⋯` menu, and a spec pinned to it would
   * pass by finding nothing. The first control is whatever the layout puts
   * there (context on the phone), which is the edge the title can collide with.
   *
   * The worst case is forced here (a long title written into the picker), since
   * the mock's own titles are short enough to hide the overlap.
   */
  test('the session title never reaches the control cluster', async ({ app }) => {
    await app.setViewportSize({ width: 320, height: 800 });

    const geometry = () =>
      app.evaluate(() => {
        const header = document.querySelector('header')!;
        const picker = header.querySelector('[data-testid="session-picker"] button') as HTMLElement | null;
        const controls = header.querySelector(':scope > div:nth-child(2)') as HTMLElement | null;
        const label = picker?.querySelector('span') ?? null;
        if (!picker || !controls || !label) return null;
        const pickerBox = picker.getBoundingClientRect();
        return {
          gap: Math.round(controls.getBoundingClientRect().left - pickerBox.right),
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
   * With a password set, the wordmark STAYS and the title still works.
   *
   * The cluster was 140px wide with the lock standing in the row (reload,
   * context, sign out, panel), which left the title 89px at 390 and 19px at
   * 320 — one letter and an ellipsis. Hiding the wordmark was tried and
   * rejected: the brand belongs in the header at every width.
   *
   * What paid for it is the cluster instead. Reload and sign-out moved into the
   * `⋯` menu, so the phone's row is context + panel + `⋯` (104px) whether or
   * not a password is set. The spec asserts the wordmark is VISIBLE at 320 and
   * 360, that the sign-out control is reachable through the menu rather than
   * the row, and that the title keeps a usable width at the narrow end.
   */
  test.describe('with a UI password', () => {
    test.use({ serverEnv: { KABMO_UI_PASSWORD: 'e2e-password' } });

    test('keeps the wordmark and the title beside the lock', async ({ harness, page }) => {
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
      await expect(page.getByRole('button', { name: 'More actions' })).toBeVisible();

      // Sign-out is a menu row now — present, but not standing in the row.
      await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
      await page.getByRole('button', { name: 'More actions' }).click();
      await expect(page.getByRole('menuitem', { name: 'Sign out' })).toBeVisible();
      await page.keyboard.press('Escape');

      const measure = () =>
        page.evaluate(() => {
          const header = document.querySelector('header')!;
          const picker = header.querySelector('[data-testid="session-picker"] button') as HTMLElement;
          const label = picker.querySelector('span') as HTMLElement;
          const controls = header.querySelector(':scope > div:nth-child(2)') as HTMLElement;
          // The wordmark is the span carrying the brand's own `ab` run.
          const brand = header.querySelector('.bg-clip-text') as HTMLElement | null;
          return {
            brandWidth: brand ? Math.round(brand.getBoundingClientRect().width) : 0,
            titleWidth: Math.round(label.getBoundingClientRect().width),
            gap: Math.round(controls.getBoundingClientRect().left - picker.getBoundingClientRect().right),
            documentWidth: document.documentElement.scrollWidth,
          };
        });

      await page.setViewportSize({ width: 360, height: 800 });
      const narrow = await measure();
      // The brand is drawn, not dropped — that is the whole point of the menu.
      expect(narrow.brandWidth).toBeGreaterThan(10);
      expect(narrow.gap).toBeGreaterThanOrEqual(4);
      // Measured 74px here: the same width the header gave the title before a
      // password was ever set, because the lock no longer costs a slot.
      expect(narrow.titleWidth).toBeGreaterThanOrEqual(70);
      expect(narrow.documentWidth).toBe(360);

      await page.setViewportSize({ width: 320, height: 800 });
      const narrowest = await measure();
      expect(narrowest.brandWidth).toBeGreaterThan(10);
      expect(narrowest.gap).toBeGreaterThanOrEqual(4);
      expect(narrowest.titleWidth).toBeGreaterThanOrEqual(50);
      expect(narrowest.documentWidth).toBe(320);

      // Past `MOBILE_FULL_ROW_PX.withSignOut` the lock comes back into the row:
      // a password is not a reason to keep a control in a menu at a width that
      // holds it.
      await page.setViewportSize({ width: 560, height: 800 });
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
      expect((await measure()).brandWidth).toBeGreaterThan(10);
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

  /**
   * The drawer's left and right columns are ONE line each, and the transcript's
   * cards share the composer's frame.
   *
   * Every number here was wrong before and none of them is visible to a unit
   * test: the drawer's folder glyph sat at 28 while the New Session button above
   * it started at 12, the folder's disclosure chevron ended 6px inside the
   * toolbar's last control, and every framed transcript block carried `mx-3` on
   * top of the timeline's own `px-3` — 24px against the composer card's 12.
   * A browser is the only place a class resolves to a pixel.
   */
  test('aligns the drawer columns and the transcript cards with the composer', async ({ app }) => {
    await app.getByRole('button', { name: 'Open Sessions' }).click();
    await expect(app.getByRole('button', { name: /new session/i }).first()).toBeVisible();

    const edges = await app.evaluate(() => {
      const rect = (el: Element | null | undefined) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right) };
      };
      const newSession = Array.from(document.querySelectorAll('button'))
        .find((b) => (b.textContent ?? '').trim() === 'New Session');
      const toolbarRow = newSession?.parentElement;
      const toolbarKids = toolbarRow ? Array.from(toolbarRow.children) : [];
      const lastControl = toolbarKids.at(-1) as HTMLElement | undefined;
      const sortButton = toolbarKids
        .map((el) => (el.tagName === 'BUTTON' ? el : el.querySelector('button')))
        .find((b) => b?.getAttribute('aria-label') === 'Sort workspaces');

      // The folder GROUP, by its own testid — not `div.mb-4`, which is only the
      // EXPANDED group's class now (a closed folder takes a row-sized gap, see
      // `Item.tsx`), so a class lookup would silently find nothing there.
      const folderRow = document.querySelector('[data-testid="session-folder"]')?.firstElementChild;
      // The SLOT, not the glyph: the folder mark is a 15px SVG centred in a
      // 16px box, so its ink starts half a pixel inside the column the rows are
      // aligned to. Comparing ink to a button's box measures that rounding, not
      // the alignment.
      const folderSlot = folderRow?.querySelector('span.w-4');
      const folderChevron = folderRow ? Array.from(folderRow.querySelectorAll('svg')).at(-1) : null;
      // Its BOX, not its ink: the drawer's right column is a line of boxes, and
      // the 4px ink inset inside them is what keeps the glyph off the tinted
      // row's corner.
      const folderChevronBox = folderChevron?.parentElement;
      const sessionRow = document.querySelector('[data-testid="session-item"]');
      const sessionSlot = sessionRow?.querySelector('span.w-4');
      const sessionAction = sessionRow?.querySelector('[aria-label="Session actions"]');
      // The DRAWER's scroller — found by the rows it contains, not by being the
      // first match in the document (the timeline is a scroller too, and it is
      // hidden while the drawer is open).
      const scroller = (sessionRow?.closest('.scrollbar-overlay-container') ?? null) as HTMLElement | null;

      return {
        newSession: rect(newSession),
        lastControl: rect(lastControl),
        sortButton: rect(sortButton),
        folderSlot: rect(folderSlot),
        folderChevron: rect(folderChevron),
        folderChevronBox: rect(folderChevronBox),
        sessionRow: rect(sessionRow),
        sessionSlot: rect(sessionSlot),
        sessionAction: rect(sessionAction),
        // True when the row could not hold every control and moved the tail
        // into `⋯` — in that case `⋯` IS the last control, not `Sort`.
        hasOverflow: Boolean(lastControl?.querySelector('[aria-label="More sidebar actions"]')),
        // How much width the platform's scrollbar takes out of the drawer's
        // own scroller: 0 on an overlay-scrollbar platform, the bar's width on
        // a classic one. The right column's absolute x depends on it.
        gutter: scroller ? scroller.offsetWidth - scroller.clientWidth : 0,
      };
    });

    // Left column: the folder's leading slot starts where the New Session
    // button does, and a session row's own slot sits on that same x.
    expect(edges.newSession).not.toBeNull();
    expect(edges.folderSlot!.left).toBe(edges.newSession!.left);
    expect(edges.sessionSlot!.left).toBe(edges.newSession!.left);
    // …and the row's tinted block starts there too.
    expect(edges.sessionRow!.left).toBe(edges.newSession!.left);

    // Right column: the folder's disclosure box and a session row's own box end
    // on the row's trailing edge — one line of boxes down the drawer.
    expect(edges.folderChevronBox!.right).toBe(edges.sessionAction!.right);

    // Against the toolbar's last control, which is OUTSIDE the scroller: the
    // drawer compensates the scrollbar with a smaller right padding (`pr-2`), so
    // the two columns agree once the gutter is accounted for. A tolerance of one
    // gutter is the honest bound — the exact x is a property of the platform's
    // scrollbar, not of this layout.
    const drift = Math.abs(edges.folderChevronBox!.right - edges.lastControl!.right);
    expect(drift).toBeLessThanOrEqual(Math.max(4, edges.gutter));

    // The rule the request named: the disclosure glyph ends on the same column
    // as the sort control. At a width that fits the whole row, Sort IS the last
    // control; below it the tail moves into `⋯`, which becomes that column
    // instead — the drift assertion above is what covers that case.
    expect(edges.sortButton).not.toBeNull();
    if (!edges.hasOverflow) expect(edges.sortButton!.right).toBe(edges.lastControl!.right);
  });

  /**
   * A CLOSED folder is a row, so it takes a row's gap AND a row's height.
   *
   * The reported "folder session yang tertutup jaraknya terlalu jauh" had two
   * causes, and fixing only the first still left the list looking loose. (1)
   * The group gap (`mb-4`, 16px) separated folders whether or not they had rows
   * under them, so two closed folders sat 59px apart on a 390px phone — 39px of
   * blank ink between their names, twice the list's own row rhythm. (2) The
   * header itself was 43px tall (`py-2` 8px + its 27px action buttons) against
   * a session row's 33px, so a closed folder was 10px taller than the rows it
   * stands in for even at a row-sized gap.
   *
   * Measured here because both are layout: `happy-dom` resolves none, so a
   * mounted unit test can only read the classes back.
   */
  test('keeps a closed folder on the list row rhythm, not the group gap', async ({ app }) => {
    await app.getByRole('button', { name: 'Open Sessions' }).click();
    const folders = app.locator('[data-testid="session-folder"]');
    await expect(folders.first()).toBeVisible();

    // A row's own height, read while the folders are still expanded.
    const rowHeight = await app.evaluate(() => {
      const row = document.querySelector('[data-testid="session-item"]');
      return row ? Math.round(row.getBoundingClientRect().height) : 0;
    });
    expect(rowHeight).toBeGreaterThan(0);

    // Collapse every folder through its own header — the name is inside the
    // clickable row, and the demo folders open expanded. Collapsing only the
    // first leaves no two CLOSED neighbours to measure.
    const count = await folders.count();
    for (let i = 0; i < count; i += 1) {
      const name = folders.nth(i).locator('span.font-semibold').first();
      if (await name.isVisible()) await name.click();
    }

    const gaps = await app.evaluate(() => {
      const groups = Array.from(document.querySelectorAll('[data-testid="session-folder"]'));
      const read = (el: Element) => {
        const header = el.firstElementChild as HTMLElement;
        return {
          top: Math.round(header.getBoundingClientRect().top),
          bottom: Math.round(header.getBoundingClientRect().bottom),
          height: Math.round(header.getBoundingClientRect().height),
          open: el.querySelector('[data-testid="session-item"]') !== null,
        };
      };
      const measured = groups.map(read);
      const closedGaps: number[] = [];
      for (let i = 1; i < measured.length; i += 1) {
        // Only two CLOSED neighbours: a group that owns rows keeps the group
        // gap, and that gap is measured from its last row, not its header.
        if (!measured[i - 1].open && !measured[i].open) {
          closedGaps.push(measured[i].top - measured[i - 1].bottom);
        }
      }
      return { measured, closedGaps };
    });

    const closed = gaps.measured.filter((m) => !m.open);
    expect(closed.length).toBeGreaterThanOrEqual(2);
    expect(gaps.closedGaps.length).toBeGreaterThan(0);

    // The gap: 4px (`mb-1`) against the 16px (`mb-4`) the group gap imposed.
    for (const gap of gaps.closedGaps) expect(gap).toBeLessThanOrEqual(8);

    // The height: a closed folder's header is built like a row, so it must not
    // tower over the rows it replaces. 2px of tolerance is the rounding of the
    // 27px action boxes inside a 35px row against a row's own 33px.
    for (const header of closed) expect(header.height).toBeLessThanOrEqual(rowHeight + 2);
  });

  test('draws a transcript card and the composer on the same frame', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-mobile-gutter');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await expect(page.getByText('e2e-mobile-gutter').first()).toBeVisible();

    const input = page.locator(`[data-testid="${TESTID.composerInput}"]`);
    await input.fill('tool:bash then answer');
    // A bare Enter inserts a newline on the phone variant (no Shift key on a
    // soft keyboard), so the send control is the only way to dispatch.
    await page.getByRole('button', { name: /send message/i }).first().click();
    await expect(page.getByRole('button', { name: /^Expand Bash/ }).first()).toBeVisible({ timeout: 30_000 });

    const frames = await page.evaluate(() => {
      const rect = (el: Element | null | undefined) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: Math.round(b.left), right: Math.round(b.right) };
      };
      const section = document.querySelector('[data-tool-section]');
      const card = section?.querySelector('div.overflow-hidden.rounded-xl');
      const composerCard = document.querySelector('[data-testid="composer-input"]')?.closest('div.rounded-xl');
      const bubble = document.querySelector('div.bg-paper.rounded-xl');
      // The two gutters, read from the elements that own them.
      const scroller = (section?.closest('.scrollbar-overlay-container') ?? null) as HTMLElement | null;
      const dock = composerCard?.parentElement?.parentElement ?? null;
      return {
        toolCard: rect(card),
        composerCard: rect(composerCard),
        bubble: rect(bubble),
        scrollerPadLeft: scroller ? getComputedStyle(scroller).paddingLeft : null,
        dockPadLeft: dock ? getComputedStyle(dock).paddingLeft : null,
      };
    });

    expect(frames.toolCard).not.toBeNull();
    expect(frames.composerCard).not.toBeNull();

    // The transcript's own gutter is `pl-4` on a phone — deliberately one step
    // wider than the composer dock's `pl-3`, which is the pairing the reader
    // approved. So each card is measured against ITS OWN gutter rather than
    // against the other: a card that drifted off its gutter would otherwise
    // pass as long as the two happened to agree.
    expect(frames.scrollerPadLeft).toBe('16px');
    expect(frames.dockPadLeft).toBe('12px');
    expect(frames.toolCard!.left).toBe(16);
    expect(frames.composerCard!.left).toBe(12);

    // The right edge is NOT asserted against the composer: the transcript is a
    // scroll container, so its right padding is one step smaller to cancel the
    // scrollbar's own width — and that width is 0 on an overlay-scrollbar
    // platform and 8px on a classic one. What IS stable is that both framed
    // blocks inside the scroller end on the same edge.
    expect(frames.bubble!.right).toBe(frames.toolCard!.right);

    workspace.dispose();
  });

  /**
   * The APK control in the drawer footer carries a glyph, like its neighbours.
   *
   * Measured in the browser before the fix: the phone's footer drew `Get APK` with
   * no mark beside it while Settings / About / Desktop all had one — the link
   * branch of the shared control rendered the word alone, and the mobile pair
   * ALWAYS takes that branch (`canSelfUpdate` refuses Android and iOS, which
   * install through their own paths). A unit test on the component can assert the
   * `<svg>` exists; only this layer proves it is on the phone's screen, in the row,
   * at the size the other glyphs use.
   */
  test('the APK offer in the drawer footer draws its glyph beside the word', async ({ harness, page }) => {
    const server = await harness('mock');
    // The real route reads GitHub, which would make this spec depend on the network
    // and on a release that happens to carry an APK. The stub is the seam; the
    // control, the footer and the drawer are real.
    await page.route('**/api/updates/android', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          url: 'https://github.com/kabmo-labs/kabmo/releases/download/v9.9.9/Kabmo-9.9.9-android.apk',
          latest: '9.9.9',
          releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
          direct: true,
        }),
      });
    });
    await openApp(page, server.baseURL);

    await page.getByRole('button', { name: 'Open Sessions' }).click();
    const control = page.getByRole('link', { name: 'Install Kabmo 9.9.9 for Android' });
    await expect(control).toBeVisible();
    await expect(control).toContainText('Get APK');

    // The glyph, measured rather than assumed: an `<svg>` with no box would satisfy
    // a DOM query and still be invisible on screen.
    const glyph = await control.locator('svg').evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: Math.round(box.width), height: Math.round(box.height) };
    });
    expect(glyph.width).toBeGreaterThan(0);
    expect(glyph.height).toBeGreaterThan(0);

    // And it is the row's own size — Settings / About / Desktop draw at 14 — so the
    // APK control is not the one entry a pixel off from its neighbours.
    const neighbour = await page
      .getByRole('button', { name: 'About' })
      .locator('svg')
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));
    expect(glyph.width).toBe(neighbour);
  });
});
