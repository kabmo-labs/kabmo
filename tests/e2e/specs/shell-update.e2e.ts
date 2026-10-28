/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The desktop shell's update control: a control in the footer, everything else in
 * a dialog.
 *
 * ## What only this layer can prove
 *
 * The unit suites mount the component and assert its tree. This one drives the
 * ASSEMBLED page — the real sidebar, the real portal target, a real click — and
 * asserts the two facts that were wrong before the dialog existed:
 *
 * 1. **The footer row's own text stays empty.** A dialog rendered inside that row
 *    put its whole sentence into the row's `textContent` (measured), which is why
 *    the modal is a portal to `document.body`.
 * 2. **The confirmation is a separate step.** The press that opens the dialog must
 *    not have asked the shell for anything; only the dialog's own button does.
 *
 * ## Why the release probe is ROUTED
 *
 * `/api/updates/desktop` reads GitHub. A spec that let it through would depend on
 * the network, an API quota shared per IP and a release that happens to carry the
 * artifact — three ways to be red for reasons the code under test did not cause.
 * The route answers a fixed payload instead, which is the same seam the unit tests
 * use; everything BELOW it (the control, the dialog, the bridge call) is real.
 */

import { test, expect, installOverlayHandler, collectConsoleErrors } from '../fixtures/app';
import type { Locator, Page } from '@playwright/test';

/**
 * The page globals this spec installs, declared once.
 *
 * Declared rather than cast at each read: the shapes below are written by the
 * `addInitScript` above and read by `bridgeCalls`, so one declaration keeps the two
 * halves of the stub in step — an inline cast at each site would let the writer and
 * the reader drift without a type error.
 */
interface ShellProbeWindow {
  __kabmoDesktop?: Record<string, unknown>;
  __kabmoCalls?: { method: string; params?: Record<string, unknown> }[];
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/** The release the probe answers, for a shell reporting `0.0.1`. */
const RELEASE = {
  url: 'https://github.com/kabmo-labs/kabmo/releases/download/v9.9.9/Kabmo-9.9.9-mac-arm64.zip',
  latest: '9.9.9',
  releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v9.9.9',
};

/**
 * The payload the real route answers, mirrored for the query it was asked.
 *
 * The stub has to vary with `?arch=`, because that IS the server's contract: an
 * architecture names the artifact and sets `direct: true`, while a probe without
 * one answers the release page with `direct: false`. A stub that always said
 * `direct: true` would make the no-arch case render a button and prove nothing —
 * measured on the first run of this spec.
 */
function releaseFor(url: string): typeof RELEASE & { direct: boolean } {
  const arch = new URL(url).searchParams.get('arch');
  return arch
    ? { ...RELEASE, direct: true }
    : { ...RELEASE, url: RELEASE.releaseUrl, direct: false };
}

/**
 * Boot a page that believes it is the macOS shell, with the bridge recorded.
 *
 * `addInitScript` runs before the page's own scripts — the same moment the real
 * shell injects its identity — so the sidebar's first paint already knows it is
 * inside a shell. The bridge stub records every command on `window.__kabmoCalls`
 * and answers `update_apply` with the sentence the real shells send.
 */
async function openAsShell(
  page: Page,
  url: string,
  options: { arch?: string; update?: { success: boolean; message: string } } = {},
): Promise<void> {
  await page.route('**/api/updates/desktop**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(releaseFor(route.request().url())),
    });
  });

  const identity = {
    platform: 'macos',
    shellVersion: '0.0.1',
    overlayTitlebar: true,
    trafficLightInset: '5rem',
    ...(options.arch ? { arch: options.arch } : {}),
  };
  const outcome = options.update ?? {
    success: true,
    message: 'Kabmo 9.9.9 installed — restarting.',
  };

  await page.addInitScript(
    ({ identityJson, outcomeJson }) => {
      const page = window as unknown as ShellProbeWindow;
      page.__kabmoDesktop = JSON.parse(identityJson);
      const calls: { method: string; params?: Record<string, unknown> }[] = [];
      page.__kabmoCalls = calls;
      page.__kabmoCall = async (method, params) => {
        calls.push({ method, params });
        if (method === 'update_apply') return JSON.parse(outcomeJson);
        if (method === 'servers_state') return { entries: [], detected: [] };
        return null;
      };
    },
    { identityJson: JSON.stringify(identity), outcomeJson: JSON.stringify(outcome) },
  );

  await installOverlayHandler(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

/**
 * The `update_apply` commands the page has sent, and nothing else.
 *
 * The bridge carries the shell's whole surface — `servers_state` is asked on every
 * mount — so "nothing was sent" would be false before the user did anything. What
 * these cases assert is that the CONTROL never asks for an install on its own.
 */
function updateCalls(page: Page): Promise<{ method: string; params?: Record<string, unknown> }[]> {
  return page.evaluate(() => {
    const probe = window as unknown as ShellProbeWindow;
    return (probe.__kabmoCalls ?? []).filter((call) => call.method === 'update_apply');
  });
}

/**
 * The glyph inside the footer control, and the row it has to line up with.
 *
 * Both branches of the shared control draw a mark — the self-updating BUTTON and
 * the release-page LINK — and the phone's variant once shipped without one
 * because only the button branch rendered it. A role/name assertion cannot see
 * that: an `<a>` with a label and no `<svg>` passes every check above, which is
 * exactly how it shipped. So this reads the RENDERED box of the mark and of the
 * neighbouring Settings / About glyphs, which are the row's reference.
 */
async function footerGlyph(control: Locator) {
  return control.evaluate((element) => {
    const box = (node: Element | null | undefined) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top) };
    };
    const mark = element.querySelector('svg');
    const row = element.parentElement;
    const neighbours = ['Settings', 'About Kabmo']
      .map((name) => row?.querySelector(`[aria-label="${name}"] svg`) ?? null)
      .map(box);
    return { mark: box(mark), neighbours, rowText: row?.textContent?.trim() ?? '' };
  });
}

test('the footer draws a control, and the confirmation is what asks the shell', async ({ harness, page }) => {
  const server = await harness('mock');
  const errors = collectConsoleErrors(page);
  await openAsShell(page, server.baseURL, { arch: 'arm64' });

  const button = page.getByRole('button', { name: 'Update Kabmo 9.9.9 for macOS' });
  await expect(button).toBeVisible();
  // A BUTTON, not a link: this shell reported its architecture, so the console can
  // name the exact artifact and the shell can install it.
  await expect(page.getByRole('link', { name: 'Update Kabmo 9.9.9 for macOS' })).toHaveCount(0);

  // The mark, measured against the row's own reference glyphs. An `<a>`/`<button>`
  // with the right label and no `<svg>` satisfies every assertion above — which is
  // how the phone's variant shipped without one.
  const glyph = await footerGlyph(button);
  expect(glyph.mark).not.toBeNull();
  expect(glyph.mark!.width).toBeGreaterThan(0);
  for (const neighbour of glyph.neighbours) {
    expect(neighbour, 'Settings / About draw the row reference').not.toBeNull();
    expect(glyph.mark!.width).toBe(neighbour!.width);
    expect(glyph.mark!.top).toBe(neighbour!.top);
  }

  // The press opens the confirmation and asks the shell NOTHING.
  await button.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Version 9.9.9');
  await expect(dialog.getByRole('button', { name: 'Install update' })).toBeVisible();
  expect(await updateCalls(page)).toEqual([]);

  // The footer row says nothing about the run — that is what the portal guarantees.
  const rowText = await page
    .getByRole('button', { name: 'About Kabmo' })
    .evaluate((element) => element.parentElement?.textContent?.trim() ?? '');
  expect(rowText).toBe('');

  await dialog.getByRole('button', { name: 'Install update' }).click();

  // The report is the SHELL's sentence, and it stays in the dialog.
  await expect(dialog).toContainText('Kabmo 9.9.9 installed — restarting.');
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeVisible();
  const afterText = await page
    .getByRole('button', { name: 'About Kabmo' })
    .evaluate((element) => element.parentElement?.textContent?.trim() ?? '');
  expect(afterText).toBe('');

  expect(await updateCalls(page)).toEqual([
    { method: 'update_apply', params: { url: RELEASE.url, version: RELEASE.latest } },
  ]);

  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('a shell that cannot say its architecture is offered the release page instead', async ({ harness, page }) => {
  const server = await harness('mock');
  const errors = collectConsoleErrors(page);
  await openAsShell(page, server.baseURL);

  // Without an architecture the console cannot name one file, so the offer is a
  // LINK to the page that lists every build — and there is no dialog to open.
  const link = page.getByRole('link', { name: 'Update Kabmo 9.9.9 for macOS' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', RELEASE.releaseUrl);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // The LINK branch draws the mark too. That branch is the mobile pair's only
  // branch, so a glyph that lives only on the button is a phone footer with a
  // word and no icon — the bug this pins.
  const glyph = await footerGlyph(link);
  expect(glyph.mark).not.toBeNull();
  expect(glyph.mark!.width).toBeGreaterThan(0);
  expect(glyph.rowText).toBe('');

  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
});

test('a refusal is the shell’s own sentence, with another try', async ({ harness, page }) => {
  const server = await harness('mock');
  const errors = collectConsoleErrors(page);
  await openAsShell(page, server.baseURL, {
    arch: 'arm64',
    update: { success: false, message: 'The downloaded file is not a signed Kabmo build.' },
  });

  await page.getByRole('button', { name: 'Update Kabmo 9.9.9 for macOS' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Install update' }).click();

  // "The update failed" tells a user nothing; the shell's reason is what they can
  // act on, and it is printed verbatim.
  await expect(dialog).toContainText('The downloaded file is not a signed Kabmo build.');
  await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();

  // Reopening after a dismissal starts at the confirmation again — a dismissed run
  // is not a run.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Update Kabmo 9.9.9 for macOS' }).click();
  const reopened = page.getByRole('dialog');
  await expect(reopened).toContainText('Version 9.9.9');
  await expect(reopened).not.toContainText('not a signed Kabmo build');

  expect(errors, `console/page errors:\n${errors.join('\n')}`).toEqual([]);
});
