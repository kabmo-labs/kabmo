/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Playwright fixture every spec's `test` is imported from.
 *
 * Its one job is lifecycle: a spec asks for a mode, and it gets a browser
 * context pointed at a chamber server that was started fresh for it and is
 * torn down when the spec ends — including on failure, so a failing spec still
 * removes its temp root and its child process. Nothing is shared between
 * specs, which is what keeps the assertions honest: a test that mutated a
 * setting cannot leak it into the next one.
 *
 * Two facts are injected rather than computed here. The repo root comes from
 * `import.meta.dirname` (this file lives at `tests/e2e/fixtures/`), so the
 * server always runs against THIS checkout. The mode comes from the spec, and
 * the fixture starts the matching server on demand — a mock spec never pays
 * for a fake `omp`, and a real spec gets one without the other spec's mode
 * leaking in.
 */

import { test as base, expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { startHarnessServer, type HarnessMode, type HarnessServer } from './server';
import * as selectors from './selectors';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface HarnessFixtures {
  /** Boot a server in the given mode and get its base URL. Memoized per test. */
  harness: (mode?: HarnessMode) => Promise<HarnessServer>;
  /** Extra env for the real-mode server (e.g. a fake `omp` path). */
  serverEnv: Record<string, string>;
}

export interface AppFixtures {
  /** A page pointed at a `mock`-mode server, the default for UI specs. */
  app: Page;
}

/**
 * Console/router noise that is not a defect of the app under test.
 *
 * Kept explicit and short. A blanket "ignore console errors" would defeat the
 * point of asserting there are none; each entry here is something a browser or
 * a dev tool emits that no chamber edit can fix. Add to this list only with a
 * measurement, never to make a red spec green.
 */
const IGNORED_CONSOLE = [
  // The bundled Chromium reports a fingerprinting/ads heuristic error on some
  // CI images; unrelated to the chamber's own code.
  /third-party cookie/i,
  // Vite/Playwright dev warnings about a sourcemap that ships with a dependency.
  /sourcemap/i,
];

function isIgnorable(text: string): boolean {
  return IGNORED_CONSOLE.some((pattern) => pattern.test(text));
}

export const test = base.extend<HarnessFixtures & AppFixtures>({
  serverEnv: [{}, { option: true }],

  harness: async ({ serverEnv }, use, testInfo) => {
    const started: HarnessServer[] = [];
    const start = async (mode: HarnessMode = 'mock'): Promise<HarnessServer> => {
      const server = await startHarnessServer({ mode, repoRoot: REPO_ROOT, env: serverEnv });
      started.push(server);
      testInfo.attach?.('server-log', { body: server.log(), contentType: 'text/plain' }).catch(() => {});
      return server;
    };
    await use(start);
    // LIFO so a real-mode server stops before the mock one it may depend on.
    for (const server of started.reverse()) await server.stop();
  },

  app: async ({ harness, page }, use) => {
    const server = await harness('mock');
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error' && !isIgnorable(message.text())) {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      if (!isIgnorable(error.message)) errors.push(error.message);
    });
    await openApp(page, server.baseURL);
    await use(page);
    // After the spec, not during: a spec that asserts on the console itself
    // reads `errors` through the `collectConsoleErrors` helper.
    expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
  },
});

/** Console errors seen so far, for a spec that wants to assert on them itself. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isIgnorable(message.text())) errors.push(message.text());
  });
  return errors;
}

/**
 * Clear the startup overlay the mock data mode produces.
 *
 * `MOCK=true` makes the update check answer "an update is available" on every
 * boot (`MOCK_CURRENT_VERSION`/`MOCK_LATEST_VERSION` in `lib/updates/check.ts`),
 * so the Update dialog opens over the whole app and its `fixed inset-0`
 * backdrop swallows every click. That is a real surface doing its job, not
 * something to disable.
 *
 * It is dismissed with a locator HANDLER rather than a single click, because
 * the check is asynchronous: the dialog appears some time after load, so a
 * click issued at `domcontentloaded` can land before it exists and then be
 * blocked by the popup that shows up afterwards. The handler fires whenever the
 * "Later" button appears, which is also what makes it correct on a reload.
 */
export async function installOverlayHandler(page: Page): Promise<void> {
  // `exact: true` is load-bearing. `getByRole(name:)` matches a SUBSTRING by
  // default, so a plain `'Later'` also matched any other button whose name
  // contains it — measured: a workspace row named `appeared-later` was matched
  // and the handler CLICKED it, navigating the dialog into that folder and
  // making the row vanish. The popup's own button is exactly "Later".
  await page.addLocatorHandler(page.getByRole('button', { name: 'Later', exact: true }), async (button) => {
    await button.click();
  });
}

/** Navigate to the app with the startup overlay handler installed. */
export async function openApp(page: Page, url: string): Promise<void> {
  await installOverlayHandler(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

export { expect, selectors, REPO_ROOT };
export type { HarnessMode, HarnessServer };
