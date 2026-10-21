/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell boots and the app renders.
 *
 * This is the smoke spec every other spec depends on: if the server does not
 * start, the client bundle does not build, or hydration throws, nothing below
 * this layer can tell you why — the failures surface as "element not found"
 * three specs later. Pinning it here means a broken bundle reports itself as a
 * broken bundle.
 *
 * The two assertions that matter are the ones a unit test cannot make: the
 * document is served by the real server (SSR shell + client bundle through
 * Bun's own asset routes), and hydration produces a mounted app tree with no
 * console error. `app-root` is the one `data-testid` this layer needs — it is
 * a container to scope every later query, not a name the UI already carries.
 */

import { test, expect } from '../fixtures/app';
import { TESTID } from '../fixtures/selectors';

test.describe('shell', () => {
  test('boots and renders the app root', async ({ app }) => {
    await expect(app.locator(`[data-testid="${TESTID.appRoot}"]`)).toBeVisible();
  });

  test('serves the document with a title and a mounted client bundle', async ({ app }) => {
    await expect(app).toHaveTitle(/Kabmo/i);
    // The bundle is what makes the tree interactive; a shell that rendered but
    // never hydrated would leave `app-root` present and the app dead. A
    // hydrated tree carries the sidebar's New Session control, which only
    // exists in the client-rendered layout. `.first()` because the demo seed
    // renders one per folder.
    await expect(app.getByRole('button', { name: /new session/i }).first()).toBeVisible();
  });

  test('has no console or page errors on a clean boot', async ({ app, harness }) => {
    // The `app` fixture already asserts zero errors at teardown; this spec
    // exists so the assertion has a name and a failing line of its own, and so
    // a reload is exercised too (a boot that only works on the first paint).
    await app.reload({ waitUntil: 'domcontentloaded' });
    await expect(app.locator(`[data-testid="${TESTID.appRoot}"]`)).toBeVisible();
    const server = await harness('mock');
    expect(server.port).toBeGreaterThan(0);
  });

  test('the health route answers for the running server', async ({ harness }) => {
    const server = await harness('mock');
    const response = await fetch(`${server.baseURL}/api/health`);
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { ok: boolean; mock: boolean; port: number };
    expect(payload.ok).toBe(true);
    expect(payload.mock).toBe(true);
    expect(payload.port).toBe(server.port);
  });

  /**
   * The navbar's last control sits a base padding from the window's right edge.
   *
   * In a PWA with `display_override: window-controls-overlay` the header also
   * reserves the window controls, and WHICH EDGE they occupy is the platform's
   * choice: `titlebar-area-x` is ~76px on macOS (traffic lights on the left) and
   * 0 on Windows (controls on the right). The header used to derive its right
   * inset as `100vw - titlebar-area-width`, which on macOS charges the traffic
   * lights' width to the WRONG edge — a measured 76px of dead space between the
   * last control and the window edge, with nothing in it.
   *
   * A browser tab cannot activate the overlay, so the env variables take their
   * fallbacks and this spec measures the geometry a tab does produce (the base
   * padding). What it can also prove is that the live header reads the CORRECT
   * expression — `titlebar-area-x` subtracted alongside the width — because that
   * is the half that only differs on macOS. `titlebar.test.ts` evaluates both
   * platform geometries.
   */
  test('the navbar reserves the window controls on the correct edge', async ({ app }) => {
    const header = app.locator('header').first();
    await expect(header).toBeVisible();

    const geometry = await header.evaluate((element) => {
      const inline = (element as HTMLElement).style.paddingRight;
      const rect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll('button')];
      const last = controls[controls.length - 1]?.getBoundingClientRect() ?? null;
      return {
        inline,
        computed: getComputedStyle(element).paddingRight,
        gap: last ? Math.round(rect.right - last.right) : null,
      };
    });

    // The overlay's width is what remains AFTER the title bar area, so both
    // coordinates are subtracted. The old form omitted `titlebar-area-x`.
    expect(geometry.inline).toContain('env(titlebar-area-x');
    expect(geometry.inline).toContain('env(titlebar-area-width');

    // A tab has no overlay, so only the base padding is left — and that is
    // exactly what the last control must clear.
    expect(geometry.computed).toBe('16px');
    expect(geometry.gap).toBe(16);
  });
});
