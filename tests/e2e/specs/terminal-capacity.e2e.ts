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

/**
 * Run a long-lived command so the shell's foreground group leaves the shell.
 *
 * The command differs by platform because the SHELL does: `sleep` is a POSIX
 * utility and `cmd.exe` has no equivalent, so on Windows it would answer
 * "not recognized" and return to the prompt immediately. There the cap counts
 * every RUNNING shell anyway (ConPTY exposes no `tpgid`), so the command only
 * has to keep the shell alive, which `ping` does without needing a busy group.
 */
function makeBusy(shell: LiveShell): void {
  const command = process.platform === 'win32'
    ? 'ping -n 121 127.0.0.1 > nul\n'
    : 'sleep 120\n';
  shell.socket.send(new TextEncoder().encode(command));
}

interface Inventory {
  terminals: { id: string; status: string; busy?: boolean; exitCode?: number | null }[];
}

test.describe('terminal capacity', () => {
  test(`the ${MAX_TERMINALS + 1}th busy shell is refused with capacity`, async ({ harness }) => {
    // The shells must actually STAY ALIVE for this precondition to exist, and
    // that is what was broken on Windows rather than the cap: the PTY child was
    // spawned `detached: true`, which on Windows is `DETACHED_PROCESS` — no
    // console at all — so `cmd.exe` exited 1 within a second and nothing ever
    // counted. `session.server.ts` now detaches on POSIX only, which is the
    // platform where a process group exists to be addressed. This spec therefore
    // runs everywhere; `busy` still differs by platform (a foreground process
    // group on POSIX, every running shell where there is none), and the poll
    // below asks each platform the question its cap actually counts.
    const server = await harness('real');
    const workspace = await seedWorkspace(server, 'e2e-terminal-cap');
    const root = workspace.path;

    const opened: LiveShell[] = [];
    // Read UNFILTERED and match on the ids this spec opened. `?root=` is a
    // PANEL concern — "which shells can this client adopt" — and it compares a
    // shell's cwd against the resolved root; the cap counts shells and asks no
    // directory question at all, so the precondition must not inherit one. The
    // id set is what keeps an unrelated shell from satisfying it.
    const readInventory = async (): Promise<Inventory> => {
      const response = await fetch(`${server.baseURL}/api/terminal/sessions`);
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
      // Polled by hand rather than through `expect.poll`, because a bare
      // "expected 8, received 0" cannot distinguish the ways this precondition
      // fails: no shells in the registry, shells under ids this spec did not
      // mint, or shells whose `status`/`busy` the platform's rule does not
      // count. The throw carries the last inventory it saw.
      const deadline = Date.now() + 20_000;
      let counted = 0;
      let lastSeen = '';
      for (;;) {
        const inventory = await readInventory();
        const seen = inventory.terminals.filter((terminal) => mine.has(terminal.id));
        counted = seen.filter(countsTowardCap).length;
        lastSeen = JSON.stringify({
          platform: process.platform,
          opened: [...mine],
          seen: seen.map((terminal) => ({
            id: terminal.id,
            status: terminal.status,
            busy: terminal.busy ?? null,
            exitCode: terminal.exitCode ?? null,
          })),
          others: inventory.terminals.length - seen.length,
        });
        if (counted === MAX_TERMINALS) break;
        if (Date.now() >= deadline) {
          throw new Error(`only ${counted} of ${MAX_TERMINALS} shells counted toward the cap: ${lastSeen}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const overflow = await attach(server.baseURL, `cap-overflow-${Date.now()}`, root).catch(
        (error: Error & { code?: string }) => error,
      );
      expect(overflow, `inventory: ${lastSeen}`).toBeInstanceOf(Error);
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
    // Runs on every platform: the Windows failure this used to skip for was the
    // PTY child dying instantly (spawned `DETACHED_PROCESS`, which has no
    // console), not the registry. See the cap spec above.
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
