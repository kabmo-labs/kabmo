/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Browser E2E config.
 *
 * The runner is Playwright's own, deliberately not `bun test`: a browser spec
 * needs a per-file browser context, a per-file server, and a trace artifact on
 * failure — a lifecycle the Bun runner does not own, and one that would fight
 * `bun test`'s single-process, shared-`globalThis` model (the reason
 * `test-support/isolated-db.ts` exists at all).
 *
 * Every project boots its OWN server from a temp root, so two projects never
 * share a database. `mock` and `real` are separate projects because they are
 * separate data modes: `mock` runs on the seeded demo presets and needs no
 * `omp` install, while `real` drives a scripted fake child through the real
 * spawn path. A spec names the mode it needs in its fixture call.
 *
 * `trace: 'on-first-retry'` plus a screenshot on failure is the evidence
 * CONTRIBUTING.md §2 asks a UI change to carry, produced by the run itself
 * rather than by hand.
 */

import { defineConfig, devices } from '@playwright/test';

const IS_CI = process.env.CI === 'true';

/**
 * The specs written for the PHONE surface, which the desktop projects skip.
 *
 * One regex, used by every project, so a new phone spec cannot be picked up by
 * `chromium` and quietly exercise the desktop tree at a phone width — which is
 * what happened to `mobile-dock.e2e.ts` while this list named one file.
 */
// NOT anchored: Playwright matches this against the file PATH
// (`…/specs/mobile.e2e.ts`), so `^mobile` matched nothing and the whole mobile
// project reported "No tests found".
const MOBILE_SPECS = /\/mobile(-dock|-files|-editor)?\.e2e\.ts$/;

export default defineConfig({
  // Relative to THIS file (`tests/e2e/`), which is how Playwright resolves it.
  testDir: './specs',
  // `.e2e.ts`, not `.spec.ts`: `bun test` also globs `*.spec.ts` and would
  // import these files into its own process, where `test.describe` throws
  // ("Playwright Test did not expect test.describe() to be called here"). The
  // two runners own disjoint globs so neither can pick up the other's files.
  testMatch: '**/*.e2e.ts',
  // A browser spec is seconds, not milliseconds; the app's first paint bundles
  // the client on demand in development.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // One worker: every spec owns a server and a real browser, and Kabmo's
  // server is a single process with a process-wide database handle. Parallel
  // servers are fine, but serializing keeps the port and CPU picture simple and
  // the failure output readable — this layer is not where speed matters.
  workers: 1,
  fullyParallel: false,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  reporter: IS_CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: IS_CI ? 'retain-on-failure' : 'off',
    // Animations make a locator's position a moving target and a screenshot a
    // coin flip; the two specs that test motion opt back in.
    reducedMotion: 'reduce',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The mobile specs are viewport-specific runs; they belong to the mobile
      // project, and running them here too would exercise the desktop tree at a
      // phone width for no reason.
      testIgnore: MOBILE_SPECS,
    },
    // Cross-browser legs, off by default (see the plan's P5). Enable with
    // `--project=firefox` / `--project=webkit` or a label-gated CI job.
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: MOBILE_SPECS,
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
      testIgnore: MOBILE_SPECS,
    },
    {
      // ONLY the phone specs: a device-emulated project runs the specs written
      // for that surface, not the desktop ones at a narrow width.
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: MOBILE_SPECS,
    },
  ],
});
