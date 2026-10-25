/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A Finder drop on the macOS shell opens the file in the editor.
 *
 * ## What only this layer can prove
 *
 * The bug was an ABSENCE, and every layer below this one looks correct without
 * it: the hook opens a path when it has one, the server resolves an absolute
 * path when it is asked, and the shell reads its pasteboard when a drop arrives.
 * What was missing was the link between them — on WebKit the page is handed
 * bytes and no path at all, so `useEditorDrop` asked the server nothing and the
 * drop was refused. Measured on macOS 27 with a real Finder pasteboard:
 *
 *     drop: types ["Files"], files [File]
 *           getData('text/uri-list') ''   getData('text/plain') ''
 *           File.path undefined           getAsFileSystemHandle undefined
 *
 * So this spec runs the assembled page as the shell, hands the hook a drop that
 * looks EXACTLY like that, and asserts the outcome a user sees: a tab for the
 * dropped file, with its text in the editor.
 *
 * ## The shell is stubbed, the server is not
 *
 * `__kabmoCall` is the one seam — it is what the real shell installs, and the
 * pasteboard read is macOS-only code that cannot run in a browser. Everything
 * else is real: the real hook, the real `/api/fs/scope` (which is what turns an
 * absolute path into a workspace-scoped tab), the real editor.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, installOverlayHandler } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';
import type { Page } from '@playwright/test';

interface ShellProbeWindow {
  __kabmoDesktop?: Record<string, unknown>;
  __kabmoDropped?: string[];
  __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Boot the page as the macOS shell, with the pasteboard answer the shell's own
 * `performDragOperation` would have recorded for the drop in flight.
 *
 * The answer is CONSUMED, like the real one: a second ask returns `null`, which
 * is what keeps one drop from opening two files.
 */
async function openAsMacShell(page: Page, url: string, droppedPath: string): Promise<void> {
  await page.addInitScript(
    ({ path }) => {
      const probe = window as unknown as ShellProbeWindow;
      probe.__kabmoDesktop = { platform: 'macos', shellVersion: '0.0.1', overlayTitlebar: true };
      probe.__kabmoDropped = [path];
      probe.__kabmoCall = async (method) => {
        if (method === 'dropped_paths') {
          const paths = probe.__kabmoDropped ?? [];
          probe.__kabmoDropped = [];
          return paths.length > 0 ? { paths, at: Date.now() } : null;
        }
        if (method === 'servers_state') return { entries: [], detected: [] };
        return null;
      };
    },
    { path: droppedPath },
  );

  await installOverlayHandler(page);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}

/**
 * Deliver the drop WebKit actually produces, onto an element INSIDE the drop
 * target.
 *
 * The handlers sit on the chat column's OWN box (`WorkspacePanels` spreads
 * `dropProps` there), not on the panel wrapper — a `drop` dispatched on the
 * wrapper bubbles UP, away from them, and nothing runs. Measured: the first
 * version of this spec asserted `false` for a drop the app would have accepted,
 * and the second addressed a timeline scroller that is not drawn on a fresh
 * session (the empty-workspace prompt is). `> div` is that box.
 *
 * The payload is the MEASURED one: `types ["Files"]` with a `File` and no
 * readable path. A spec that also set `text/uri-list` would pass on the old
 * code, because the old code's fallback is exactly what it exercises — which is
 * why the URI list is deliberately absent here.
 *
 * `items.add(new File(...))` is how a page can produce a file-carrying
 * `DataTransfer` at all (a constructor argument cannot carry files), and it
 * yields the same `types` a Finder drag does.
 */
async function dropOnEditor(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!element) return false;
    const transfer = new DataTransfer();
    transfer.items.add(new File(['export const droppedOnShell = true;\n'], 'dropped-on-shell.ts'));
    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer,
      clientX: 20,
      clientY: 20,
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }, selector);
}

test.describe('a Finder drop on the macOS shell', () => {
  test('opens the dropped file as a tab', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-shell-drop');
    const dropped = join(workspace.path, 'dropped-on-shell.ts');
    writeFileSync(dropped, 'export const droppedOnShell = true;\n');

    await openAsMacShell(page, `${server.baseURL}/?folderId=${workspace.id}`, dropped);

    // The workspace must be the ACTIVE one before a drop resolves against it:
    // `/api/fs/scope` answers a path inside any registered folder, but the
    // editor column is drawn from the active project.
    await page.getByText('dropped-on-shell.ts', { exact: false }).first().waitFor({ timeout: 15_000 }).catch(() => {});
    await expect(page.getByTestId('app-root')).toBeVisible({ timeout: 15_000 });

    const claimed = await dropOnEditor(page, '[data-panel-id="center-panel"] > div');
    expect(claimed).toBe(true);

    // The tab, and the file's own text in the buffer — the outcome the user
    // asked for, not the plumbing that produced it.
    const panel = page.locator('[data-panel-id="editor-panel"]');
    await expect(panel.getByTitle(/dropped-on-shell\.ts/).first()).toBeVisible({ timeout: 15_000 });
    await expect(panel.locator('.cm-content')).toContainText('droppedOnShell', { timeout: 15_000 });

    // And the shell's answer was consumed: the second drop of the same gesture
    // cannot reopen it.
    const remaining = await page.evaluate(() => {
      const probe = window as unknown as ShellProbeWindow;
      return probe.__kabmoDropped ?? [];
    });
    expect(remaining).toEqual([]);

    workspace.dispose();
  });
});
