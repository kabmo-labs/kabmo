/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The terminal panel opens a REAL pseudo-terminal.
 *
 * This is the only spec that proves the PTY path end to end: the browser dials
 * the terminal WebSocket, the server spawns a shell on a `Bun.Terminal`, the
 * bytes the shell writes come back as binary frames, and the terminal consumes
 * them.
 * Everything below the socket — the registry, the scrollback replay, the resize
 * signal — is covered by unit tests against the runtime; what a unit test cannot
 * show is that a person typing in a browser reaches a real shell and reads its
 * answer.
 *
 * The assertion reads the terminal WebSocket's own FRAMES, not the DOM. The
 * renderer paints into a canvas, so there is no text node to query, and
 * scraping a canvas would test the renderer rather than the transport. The
 * frames are the contract: bytes out on a keystroke, the shell's answer back on
 * the same socket.
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
    // A frame is one of two things. Control frames (`ready`, `exit`, `error`)
    // arrive as JSON text and are kept verbatim; the `ready` one is the
    // readiness signal below. PTY bytes arrive as binary frames, and a binary
    // frame is the ONLY shape that can carry them: Elysia's `ws.send`
    // JSON-stringifies every object that is not a Buffer, so a `Uint8Array`
    // used to reach the browser as text (`{"0":101,"1":99,…}`) and the client
    // dropped it as an unknown control frame. The server now wraps PTY frames
    // in a Buffer view (`asBinaryFrame` in `send-result.ts`), and the counter
    // below pins that: a regression back to text makes the marker check fail,
    // because the app no longer carries a byte-map fallback.
    //
    const received: string[] = [];
    let binaryFrames = 0;
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
        // Control JSON arrives as text; a serialized byte map still decodes,
        // which is what a regressed server would send.
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

    // Playwright's declared payload type is `string | Buffer`, so this listener
    // still decodes both shapes; it is the proof, not the product path.
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/api/terminal/')) return;
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string') binaryFrames += 1;
        received.push(asText(payload));
      });
    });

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
    await expect(page.locator('[data-terminal-root]')).toBeVisible({ timeout: 20_000 });

    // Wait for the shell before typing. The root is visible the moment the
    // renderer mounts, which is before the PTY has attached and drawn
    // anything —
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
    await page.locator('[data-terminal-input]').focus();
    await page.keyboard.type(`echo ${marker}\n`);

    // The shell echoes the typed line and then its output — both arrive as
    // frames. A unique marker means the assertion cannot pass on the prompt.
    await expect
      .poll(() => received.join(''), { timeout: 20_000 })
      .toContain(marker);
    // The marker proved the bytes reached the app; this proves they arrived as
    // binary frames, which is what the client's ArrayBuffer branch consumes.
    expect(binaryFrames).toBeGreaterThan(0);

    // A theme switch cannot recolor the WASM palette in place: the view rebuilds
    // the terminal and reattaches, which produces a second `ready` and replays
    // the retained scrollback. The sample below is the surface: the terminal
    // paints none at all, so the panel's chrome shows through — alpha 0 here,
    // whether the theme is light or dark.
    const readyFrames = () => received.filter((payload) => payload.includes('"t":"ready"')).length;
    const beforeSwitch = readyFrames();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'nord-dark';
      window.dispatchEvent(new CustomEvent('omp:theme-changed', { detail: 'nord-dark' }));
    });
    await expect.poll(readyFrames, { timeout: 20_000 }).toBeGreaterThan(beforeSwitch);
    await expect
      .poll(async () => page.evaluate(() => {
        const canvas = document.querySelector('[data-terminal-root] canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const context = canvas.getContext('2d');
        if (!context) return null;
        const sample = context.getImageData(Math.floor(canvas.width * 0.5), Math.floor(canvas.height * 0.75), 1, 1).data;
        return [sample[0], sample[1], sample[2], sample[3]];
      }), { timeout: 20_000 })
      .toEqual([0, 0, 0, 0]);

    workspace.dispose();
  });

  // The renderer's cell box is ours (`measureTerminalCell`), not ghostty-web's:
  // measuring `M` leaves a 13 px cell whose last pixel is the descender, so an
  // SGR background block ends exactly where `g`/`y`/`p` do and reads as cropped.
  // The assertion is on the canvas pixels because a background block has no DOM.
  test('a painted cell background holds the descenders', async ({ harness, page }) => {
    test.skip(process.platform === 'win32', 'needs a POSIX shell for printf');
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-cell');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
    await expect(page.locator('[data-terminal-root]')).toBeVisible({ timeout: 20_000 });

    const painted = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('[data-terminal-root] canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return null;
        const context = canvas.getContext('2d');
        if (!context) return null;
        const { width, height } = canvas;
        const data = context.getImageData(0, 0, width, height).data;
        const at = (x: number, y: number) => {
          const i = (y * width + x) * 4;
          return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
        };
        // Blue is the one background the prompt does not paint, so the sample
        // row is unambiguous even when the prompt's own bands share the column.
        const blue = ([r, , b]: number[]) => b > r + 60;
        // Bands are read down a column inside the block's first cell, which is a
        // space, so the row's own background paints there uninterrupted.
        const bands: { color: string; y0: number; y1: number }[] = [];
        let band: { color: string; y0: number; y1: number } | null = null;
        for (let y = 0; y < height; y += 1) {
          const rgb = at(4, y);
          const key = rgb.join(',');
          if (blue(rgb)) {
            if (band !== null && band.color === key) band.y1 = y;
            else {
              if (band !== null) bands.push(band);
              band = { color: key, y0: y, y1: y };
            }
          } else if (band) {
            bands.push(band);
            band = null;
          }
        }
        if (band) bands.push(band);
        // The sample is the last line the shell printed, i.e. the lowest band.
        const block = bands.at(-1);
        if (!block) return null;
        // Glyph ink is the near-black foreground; the block's own antialiased
        // edge is a blend towards the block, never this dark. `alpha > 0`
        // matters: the canvas has no background of its own, so an untouched
        // pixel is transparent — and (0,0,0,0) would otherwise read as ink.
        let inkTop = Infinity;
        let inkBottom = -1;
        for (let y = block.y0; y <= block.y1; y += 1) {
          for (let x = 0; x <= 11 * 8 + 4; x += 1) {
            const [r, g, b] = at(x, y);
            const alpha = data[(y * width + x) * 4 + 3];
            if (alpha === 0 || r > 150 || g > 150 || b > 150) continue;
            inkTop = Math.min(inkTop, y);
            inkBottom = Math.max(inkBottom, y);
          }
        }
        // Device pixels: report the band in CSS px so the assertion is the cell
        // height itself, not twice it on a 2x display.
        const dpr = canvas.width / canvas.clientWidth;
        return {
          y0: block.y0,
          y1: block.y1,
          height: (block.y1 - block.y0 + 1) / dpr,
          inkTop,
          inkBottom,
        };
      });

    // `LIVE` is the panel's own status for `running`, set when the socket's
    // `ready` frame arrives — the same signal the first test waits for, and
    // readable without a canvas pixel heuristic that depends on the prompt.
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-terminal-input]').focus();
    await page.keyboard.type("clear; printf '\\033[44m    ggyypp    \\033[0m\\n'");
    await page.keyboard.press('Enter');

    // Poll on the block itself, not on "something is painted": the cursor is a
    // one-pixel-high band while the command is still being typed.
    await expect
      .poll(async () => (await painted())?.height ?? 0, { timeout: 20_000 })
      .toBeGreaterThanOrEqual(14);
    const block = await painted();
    if (!block) throw new Error('the painted block was not found');

    // A descender must not end on the block's last pixel, and the cap must not
    // start on its first: at 12 px Fira Code the cell is 16 px — 11 px of ink
    // plus 4 px above and 1 px below (the vendor's own measurement gives 13).
    expect(block.height).toBeGreaterThanOrEqual(16);
    expect(block.inkTop).toBeGreaterThan(block.y0);
    expect(block.inkBottom).toBeLessThan(block.y1);

    workspace.dispose();
  });

  // The panel opens with a width transition, so an early fit measures a squeezed
  // box. A grid announced from that measurement resized the PTY to a few columns
  // (`resize 5x37` was measured reaching a real shell), the shell redrew its
  // prompt hard-wrapped at that width, and that output lived in the scrollback
  // forever — every reload replayed one more wrapped prompt block above the
  // live one, so the prompt marched down the panel.
  test('a reload never resizes the shell to a squeezed grid', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-grid');
    const resizes: { cols: number; rows: number }[] = [];
    const replays: number[] = [];
    page.on('websocket', (socket) => {
      if (!socket.url().includes('/api/terminal/')) return;
      socket.on('framesent', ({ payload }) => {
        if (typeof payload !== 'string' || !payload.includes('"t":"resize"')) return;
        resizes.push(JSON.parse(payload) as { cols: number; rows: number });
      });
      socket.on('framereceived', ({ payload }) => {
        if (typeof payload !== 'string' || !payload.includes('"t":"ready"')) return;
        replays.push((JSON.parse(payload) as { replayBytes?: number }).replayBytes ?? 0);
      });
    });

    const open = async () => {
      const root = page.locator('[data-terminal-root]');
      // A reload restores the session's last right-panel view, so the terminal
      // may already be opening: clicking its button then would CLOSE it.
      const alreadyOpening = await root
        .waitFor({ state: 'visible', timeout: 4_000 })
        .then(() => true)
        .catch(() => false);
      if (!alreadyOpening) {
        await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
        await expect(root).toBeVisible({ timeout: 20_000 });
      }
      await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 20_000 });
      // The settle gate is 120 ms; wait past it so a late commit would land.
      await page.waitForTimeout(600);
    };

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await open();
    await page.reload();
    await open();
    const afterFirstReload = replays.at(-1) ?? 0;
    await page.reload();
    await open();
    const afterSecondReload = replays.at(-1) ?? 0;

    // Every grid the client announced was one a person could see.
    expect(resizes.filter((size) => size.cols < 10 || size.rows < 5)).toEqual([]);
    // A shell that was not resized writes nothing between two attachments, so the
    // replay is byte-identical. A redraw would show up here as growth.
    expect(afterSecondReload).toBe(afterFirstReload);
    expect(afterFirstReload).toBeGreaterThan(0);

    workspace.dispose();
  });

  // ghostty-web makes the host `contenteditable` (for IME and `beforeinput`),
  // so a click on the 6px padding focuses the DIV and the browser paints its
  // own caret there: a black blinking bar at the left edge, 24px tall on this
  // host's inherited line box. The terminal's cursor is the canvas block.
  test('clicking the terminal padding paints no DOM caret', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-caret');

    await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
    await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
    const host = page.locator('[data-terminal-root]');
    await expect(host).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 20_000 });

    const box = await host.boundingBox();
    if (!box) throw new Error('the terminal host has no box');
    // Inside the `p-1.5` padding, outside the canvas: the one spot that focuses
    // the host rather than ghostty's hidden textarea.
    await page.mouse.click(box.x + 3, box.y + 3);

    const caret = await host.evaluate((element) => ({
      focused: document.activeElement === element,
      color: getComputedStyle(element).caretColor,
    }));
    expect(caret.focused).toBe(true);
    expect(caret.color).toBe('rgba(0, 0, 0, 0)');

    workspace.dispose();
  });
});
