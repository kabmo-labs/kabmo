/**
 * @license
 * SPDX-License-Identifier: MIT
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
 * RUNS ON WINDOWS TOO, and the comment that said otherwise was wrong twice.
 * `Bun.Terminal` is supported there through ConPTY, and the reason this spec was
 * skipped was an ASSERTION limit that the assertions below do not actually have:
 * neither of them compares bytes. The prompt check is a character class
 * (`cmd.exe`'s `C:\…>` satisfies it) and the command check is `toContain` on a
 * unique marker, which ConPTY renders like any other output. What ConPTY does
 * NOT preserve is the exact escape stream, so a spec asserting the raw frames
 * verbatim would fail on a working terminal — that is a different test.
 *
 * The panel itself was genuinely broken on Windows until the spawn was fixed:
 * `detached: true` there means `DETACHED_PROCESS`, so the child had no console
 * and `cmd.exe` exited 1 immediately. See `session.server.ts`.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

test.describe('terminal', () => {
  test('opens a shell and the shell answers a command', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal');

    // Record the terminal socket's traffic BEFORE the panel mounts, so no
    // frame is missed.
    //
    // A frame is one of two things, and the shell's half needs decoding.
    // Control frames (`ready`, `exit`, `error`) arrive as JSON text and are
    // kept verbatim; the `ready` one is the readiness signal below. The shell's
    // own bytes arrive as a byte map SERIALIZED TO TEXT — measured on Bun
    // 1.4.4, the `echo` landing as `{"0":101,"1":99,"2":104,"3":111}` with
    // `typeof payload === 'string'`. A UTF-8 cast of that is not the shell's
    // output, and `payload.toString()` on it is a no-op, so the marker check
    // never matched even though the terminal had plainly answered. The map is
    // therefore parsed and rebuilt into bytes first.
    //
    // Playwright's declared payload type is `string | Buffer`, so the binary
    // shapes are handled too — they are what a future Bun would send, and this
    // is the only spec that would notice.
    const received: string[] = [];
    const fromByteMap = (value: unknown): string | null => {
      if (typeof value !== 'object' || value === null) return null;
      const record = value as Record<string, unknown>;
      // Every own key is a decimal byte index and the value at it is that byte,
      // so the size is the highest index plus one. `length` is NOT used: a map
      // that reached this listener as JSON has no `length` at all, and a real
      // `Uint8Array` never takes this path (it is decoded whole, below).
      let size = 0;
      for (const key of Object.keys(record)) {
        if (!/^(?:0|[1-9]\d*)$/.test(key)) return null;
        size = Math.max(size, Number(key) + 1);
      }
      if (size === 0) return null;
      const bytes = new Uint8Array(size);
      for (let i = 0; i < size; i += 1) {
        const byte = record[String(i)];
        if (typeof byte !== 'number') return null;
        bytes[i] = byte;
      }
      return new TextDecoder().decode(bytes);
    };
    const asText = (payload: unknown): string => {
      if (typeof payload === 'string') {
        // Control JSON arrives as text; a byte map arrives as TEXT too when it
        // was serialized before reaching this listener.
        if (payload.startsWith('{"0":')) {
          try {
            return fromByteMap(JSON.parse(payload)) ?? payload;
          } catch {
            return payload;
          }
        }
        return payload;
      }
      if (payload instanceof Uint8Array) return new TextDecoder().decode(payload);
      if (payload instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(payload));
      // A `Buffer` reports its bytes through `toString`, but the string it
      // produces is the byte-map JSON, so it is decoded from that.
      const mapped = fromByteMap(payload);
      if (mapped !== null) return mapped;
      const viaString = String(payload);
      if (viaString.startsWith('{"0":')) {
        try {
          return fromByteMap(JSON.parse(viaString)) ?? viaString;
        } catch {
          return viaString;
        }
      }
      return viaString;
    };
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/api/terminal/')) return;
      socket.on('framereceived', ({ payload }) => {
        received.push(asText(payload));
      });
    });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
    await expect(page.locator('.xterm')).toBeVisible({ timeout: 20_000 });

    // Wait for the shell before typing. `.xterm` is visible the moment xterm
    // mounts, which is before the PTY has attached and drawn anything —
    // keystrokes sent in that window are written to a socket with no shell
    // behind them and are lost, which is the flake this pins.
    //
    // The readiness signal is the protocol's OWN `ready` frame, not the shape
    // of the prompt: a prompt is the user's to configure, and a machine running
    // Starship draws its symbol from a private-use codepoint rather than any of
    // `$ % # > ❯ ┃ │`. Measured on this machine: the prompt arrived as
    // `\u{f0792} rajebdev@… ❯ "` and the glyph regex never matched, so the case
    // timed out on both attempts despite a working terminal.
    await expect
      .poll(() => received.join(''), { timeout: 20_000 })
      .toContain('"t":"ready"');

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
