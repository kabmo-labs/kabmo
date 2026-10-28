/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `detectBusyShells` decides the terminal cap's budget, so it has to be right
 * about the two states that matter: a shell at its prompt (not counted) and a
 * shell running a command (counted). Both are observed against a real PTY,
 * because the whole question is what the *kernel* says the terminal's
 * foreground group is — a mocked probe would only test the mock.
 *
 * The probe's answer is cross-checked against `ps -o tpgid=`, which is the
 * definition of the field being read: an offset that drifted makes the probe
 * return null (its own pid guard rejects a mismatched struct) and fail these
 * assertions rather than silently report a garbage group.
 *
 * Waiting is driven by the PTY stream, not by sleeps: a shell's prompt (or the
 * marker a command prints before it parks) is the real signal that the
 * foreground group has moved, so the assertions never race a guessed delay.
 */

import { afterAll, expect, test } from 'bun:test';

import { processProbe } from '@/server/lib/lifecycle/proc';
import { shellLaunch } from '@/server/lib/terminal/shell';
import { detectBusyShells, type ShellProcess } from '@/server/lib/terminal/foreground';
import { describePosix } from '@/test-support/platform';

/** The shell the test drives, and the prompt it announces itself with. */
const SHELL = '/bin/sh';
/**
 * Spelled `CHAM''BER` on the command line below: the PTY echoes what is typed,
 * so a literal needle would be satisfied by the echo before the shell ever
 * parsed the line — the same trap the busy marker avoids.
 */
const PROMPT = 'CHAMBER> ';

/** The value `ps` prints for the same field the probe reads. */
async function psTpgid(pid: number): Promise<number> {
  const proc = Bun.spawn(['ps', '-o', 'tpgid=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  return Number(text.trim());
}

interface PtyShell {
  id: string;
  pid: number;
  term: Bun.Terminal;
  proc: Bun.Subprocess;
  /** Resolves the next time the PTY emits `needle`; output seen so far counts. */
  until: (needle: string) => Promise<void>;
}

const spawned: PtyShell[] = [];

async function spawnShell(id: string): Promise<PtyShell> {
  let seen = '';
  let pending: { needle: string; resolve: () => void } | null = null;
  const term = new Bun.Terminal({
    cols: 80,
    rows: 24,
    name: 'xterm-256color',
    data(_term, bytes) {
      seen += new TextDecoder().decode(bytes);
      if (pending && seen.includes(pending.needle)) {
        const { resolve } = pending;
        pending = null;
        resolve();
      }
    },
  });
  // The production launch argv, not a bare `/bin/sh`. The runtime must spawn
  // `detached: true`, and `setsid()` drops the controlling terminal — a shell
  // that never re-opens the PTY reports `tpgid` as -1 (verified on Linux), which
  // reads as "a command owns the terminal" and is what made the prompt
  // assertion below fail there. `shellLaunch` is the shim that re-acquires it,
  // so this is the shell shape the probe is actually asked about.
  const proc = Bun.spawn(shellLaunch(SHELL), { terminal: term, detached: true, cwd: '/tmp' });
  const shell: PtyShell = {
    id,
    pid: proc.pid,
    term,
    proc,
    until(needle) {
      if (seen.includes(needle)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        pending = { needle, resolve };
      });
    },
  };
  spawned.push(shell);
  return shell;
}

afterAll(async () => {
  for (const shell of spawned) {
    try {
      shell.term.write('\u0003exit\n');
    } catch {
      // Already closed.
    }
  }
  await Promise.all(spawned.map((shell) => shell.proc.exited.catch(() => undefined)));
});

describePosix('processProbe.foregroundGroup', () => {
  test('reports the same group ps does for a live pid', async () => {
    const fromProbe = processProbe.foregroundGroup(process.pid);
    expect(fromProbe).not.toBeNull();
    expect(fromProbe).toBe(await psTpgid(process.pid));
  });

  test('returns null for a pid that no longer exists', async () => {
    const corpse = Bun.spawn(['/bin/sh', '-c', 'exit 0']);
    const deadPid = corpse.pid;
    await corpse.exited;
    expect(processProbe.foregroundGroup(deadPid)).toBeNull();
  });
});

describePosix('detectBusyShells', () => {
  test('a shell at its prompt is not busy, and one running a command is', async () => {
    const shell = await spawnShell('probe');
    const shells: ShellProcess[] = [{ id: shell.id, pid: shell.pid }];

    // The prompt is the shell printing from its own foreground group. It is
    // named by us rather than assumed: the default is `$ ` for a user and `# `
    // for root, and the assertion is about the foreground group, not the glyph.
    shell.term.write("PS1='CHAM''BER> '\n");
    await shell.until(PROMPT);
    expect((await detectBusyShells(shells)).has(shell.id)).toBe(false);

    // The marker is printed by a child that already owns the terminal, and the
    // typed text spells it `REA''DY` — a literal needle would be matched by the
    // PTY's own echo of the input, before the shell had even parsed the line.
    shell.term.write("sh -c 'echo REA''DY; sleep 30'\n");
    await shell.until('READY\r\n');
    expect((await detectBusyShells(shells)).has(shell.id)).toBe(true);
  });

  test('falls back to ps when one pid cannot be probed, and still answers', async () => {
    const shell = await spawnShell('fallback');
    const corpse = Bun.spawn(['/bin/sh', '-c', 'exit 0']);
    const ghostPid = corpse.pid;
    await corpse.exited;

    shell.term.write("sh -c 'echo REA''DY; sleep 30'\n");
    await shell.until('READY\r\n');

    // A dead pid is one the probe declines, which routes the whole set through
    // `ps` — the path the BSDs take for every question.
    const shells: ShellProcess[] = [
      { id: shell.id, pid: shell.pid },
      { id: 'ghost', pid: ghostPid },
    ];
    const busy = await detectBusyShells(shells);
    expect(busy.has(shell.id)).toBe(true);
    expect(busy.has('ghost')).toBe(false);
    expect(busy.size).toBe(1);
  });
});
