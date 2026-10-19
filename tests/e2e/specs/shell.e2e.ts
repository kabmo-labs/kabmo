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
});
