/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The terminal panel opens a REAL pseudo-terminal.
 *
 * This is the only spec that proves the PTY path end to end: the browser dials
 * the terminal WebSocket, the server spawns a shell on a `Bun.Terminal`, the
 * bytes the shell writes come back as binary frames, and xterm consumes them.
 * Everything below the socket — the registry, the scrollback replay, the resize
 * signal — is covered by unit tests against the runtime; what a unit test cannot
 * show is that a person typing in a browser reaches a real shell and reads its
 * answer.
 *
 * The assertion reads the terminal WebSocket's own FRAMES, not the DOM. xterm
 * paints through a WebGL canvas (`.xterm-rows` is empty by design), so there is
 * no text node to query, and scraping a canvas would test the renderer rather
 * than the transport. The frames are the contract: bytes out on a keystroke,
 * the shell's answer back on the same socket.
 *
 * SKIPPED ON WINDOWS, and there is nothing to weaken here: the server's
 * terminal is a `Bun.Terminal`, and that API — the PTY — is not implemented on
 * Windows at all (`Bun.Terminal` is POSIX-only). The panel therefore cannot
 * open a shell there for any spec to observe, so this is a platform limit
 * rather than an untested case. The panel itself still renders on Windows; what
 * is unverified there is the PTY behind it.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

// Playwright's own skip, not a hand-rolled `if`: it reports the reason in the
// run's output, so a Windows leg that skipped this is visible rather than
// silently absent.
const describeTerminal = process.platform === 'win32' ? test.describe.skip : test.describe;

describeTerminal('terminal', () => {
  test('opens a shell and the shell answers a command', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal');

    // Record the terminal socket's traffic BEFORE the panel mounts, so no
    // frame is missed. Payloads arrive as strings (control JSON) or Buffers
    // (raw PTY bytes); both are decoded to text for the assertion.
    const received: string[] = [];
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/api/terminal/')) return;
      socket.on('framereceived', ({ payload }) => {
        received.push(typeof payload === 'string' ? payload : payload.toString('utf8'));
      });
    });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 20_000 });

    // Wait for the shell's PROMPT before typing. `.xterm` is visible the moment
    // xterm mounts, which is before the PTY has attached and drawn anything —
    // keystrokes sent in that window are written to a socket with no shell
    // behind them and are lost, which is the flake this pins. The prompt's own
    // bytes on the socket are the readiness signal.
    await expect.poll(() => received.join(''), { timeout: 20_000 }).toMatch(/\$|%|#|>|❯|┃|│/);

    const marker = `omc-e2e-${Date.now()}`;
    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type(`echo ${marker}\n`);

    // The shell echoes the typed line and then its output — both arrive as
    // frames. A unique marker means the assertion cannot pass on the prompt.
    await expect
      .poll(() => received.join(''), { timeout: 20_000 })
      .toContain(marker);

    workspace.dispose();
  });
});
