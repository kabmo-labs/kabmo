/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The terminal cap is a LIMIT, not a statistic.
 *
 * `MAX_TERMINALS` is 8 and the server refuses the ninth shell with
 * `TerminalRuntimeError('capacity')`. That refusal is the whole point of the
 * cap, and it is invisible to a unit test that counts records: the count is an
 * input, the refusal is the behaviour.
 *
 * This spec exists because the cap silently stopped working on Windows. The
 * budget was `countLiveTerminals()`, which is `detectBusyShells().size` — and
 * `detectBusyShells` answers "nothing is busy" on Windows because a ConPTY has
 * no `tpgid`. So the count was always 0, the comparison was never true, and a
 * client could open shells without limit. Nothing failed; the limit simply did
 * not exist there.
 *
 * WHY THE SHELLS ARE MADE BUSY HERE. The budget is BUSY shells on purpose: an
 * idle shell sitting at its prompt is not consuming a slot, or a panel reopened
 * a few times would pin the budget with nothing running. So a spec that only
 * opened eight shells would prove nothing — measured against this suite, nine
 * idle shells all opened, and the assertion that the ninth is refused failed
 * with `ready: true`. Each shell therefore runs `sleep`, which moves the PTY's
 * foreground group onto that command and makes it count.
 *
 * Readiness is a CONDITION, never a delay, and the condition is the CAP's own
 * input rather than a proxy for it. That input differs by platform, because the
 * cap deliberately does: `busy` is what the platform can tell (a foreground
 * process group, from `tpgid`), and Windows has none, so there the cap budgets
 * every running shell instead. Polling `busy` on Windows therefore waits for a
 * number that is always 0 by design and times out — measured on the Windows leg,
 * where the shells were open and the count sat at 0 for the whole budget. So
 * POSIX polls the busy count (which is what its cap counts), Windows polls the
 * running count, and the `sleep` still runs on both: it is what makes the POSIX
 * half meaningful, and harmless where it is not consulted.
 */

import { test, expect, openApp } from '../fixtures/app';
import { seedWorkspace } from '../fixtures/seed';

/** Must match `MAX_TERMINALS` in `runtime.server.ts`. */
const MAX_TERMINALS = 8;

interface LiveShell {
  id: string;
  socket: WebSocket;
}

/**
 * Attach one shell and resolve once the server reports it ready.
 *
 * The socket is RETURNED rather than closed: a closed socket detaches the
 * viewer, and the shell is then reaped as an exited-with-no-viewers corpse —
 * which would empty the budget between attaches.
 */
function attach(baseURL: string, id: string, root: string): Promise<LiveShell> {
  return new Promise<LiveShell>((resolve, reject) => {
    const url = baseURL.replace(/^http/, 'ws');
    const socket = new WebSocket(`${url}/api/terminal/${encodeURIComponent(id)}/ws`);

    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ t: 'attach', cols: 80, rows: 24, root }));
    });
    socket.addEventListener('message', (event) => {
      const payload = typeof event.data === 'string' ? event.data : '';
      if (!payload.startsWith('{')) return;
      let frame: { t?: string; code?: string };
      try {
        frame = JSON.parse(payload) as { t?: string; code?: string };
      } catch {
        return;
      }
      if (frame.t === 'ready') resolve({ id, socket });
      else if (frame.t === 'error') {
        socket.close();
        reject(Object.assign(new Error(`attach refused: ${frame.code}`), { code: frame.code }));
      }
    });
    socket.addEventListener('error', () => reject(new Error(`socket failed for ${id}`)));
  });
}

/** Run a long-lived command so the shell's foreground group leaves the shell. */
function makeBusy(shell: LiveShell): void {
  // `sleep 120` outlives this spec; the shell is killed in `finally`.
  shell.socket.send(new TextEncoder().encode('sleep 120\n'));
}

interface Inventory {
  terminals: { id: string; status: string; busy?: boolean }[];
}

test.describe('terminal capacity', () => {
  test(`the ${MAX_TERMINALS + 1}th busy shell is refused with capacity`, async ({ harness }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-cap');
    const root = workspace.path;

    const opened: LiveShell[] = [];
    // Scoped the way the panel scopes it, AND matched on the ids this spec
    // opened: the scope is what a real client asks for, while the id set keeps
    // an unrelated shell from satisfying the precondition.
    const readInventory = async (): Promise<Inventory> => {
      const response = await fetch(`${server.baseURL}/api/terminal/sessions?root=${encodeURIComponent(root)}`);
      expect(response.ok).toBe(true);
      return (await response.json()) as Inventory;
    };

    try {
      for (let i = 0; i < MAX_TERMINALS; i += 1) {
        const shell = await attach(server.baseURL, `cap-${Date.now()}-${i}`, root);
        opened.push(shell);
        makeBusy(shell);
      }

      // Wait until the registry COUNTS them, using the same rule the cap does:
      // a foreground group on POSIX, every running shell where the platform
      // cannot tell idle from busy (`countLiveTerminals`).
      const countsTowardCap = process.platform === 'win32'
        ? (terminal: Inventory['terminals'][number]) => terminal.status === 'running'
        : (terminal: Inventory['terminals'][number]) => terminal.busy === true;
      const mine = new Set(opened.map((shell) => shell.id));
      await expect
        .poll(async () => {
          const inventory = await readInventory();
          return inventory.terminals.filter((terminal) => mine.has(terminal.id) && countsTowardCap(terminal)).length;
        }, { timeout: 20_000 })
        .toBe(MAX_TERMINALS);

      const overflow = await attach(server.baseURL, `cap-overflow-${Date.now()}`, root).catch(
        (error: Error & { code?: string }) => error,
      );
      expect(overflow).toBeInstanceOf(Error);
      // The CODE, not just the refusal: `capacity` is the cap, while any other
      // code would mean the ninth attach failed for an unrelated reason and the
      // assertion passed by accident.
      expect((overflow as Error & { code?: string }).code).toBe('capacity');
    } finally {
      for (const shell of opened) {
        try {
          shell.socket.send(JSON.stringify({ t: 'close' }));
          shell.socket.close();
        } catch {
          // Already gone.
        }
      }
      workspace.dispose();
    }
  });
});

test.describe('terminal panel', () => {
  test('a shell the panel opens is counted by the same registry the cap reads', async ({ harness, page }) => {
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-open');

    try {
      await openApp(page, `${server.baseURL}/?folderId=${workspace.id}`);
      await page.getByRole('button', { name: 'Terminal (Bun)' }).click();
      await expect(page.locator('.xterm')).toBeVisible({ timeout: 20_000 });

      // The inventory endpoint reads the SAME registry the cap budgets, so a
      // shell the panel opened must appear there. This is what proves the two
      // surfaces agree — a cap counting a different set than the panel creates
      // would pass its own unit test and still be wrong.
      //
      // `.xterm` is visible the moment xterm mounts, which is BEFORE the socket
      // attaches and the shell exists, so a single read here is a race. The
      // condition is the registry's own answer, polled until it lands.
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`${server.baseURL}/api/terminal/sessions`);
            if (!response.ok()) return -1;
            const body = (await response.json()) as { terminals: { status: string }[] };
            return body.terminals.filter((terminal) => terminal.status === 'running').length;
          },
          { timeout: 20_000 },
        )
        .toBeGreaterThan(0);
    } finally {
      workspace.dispose();
    }
  });
});
