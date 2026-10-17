/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Process probes: what liveness and identity answer for a PID.
 *
 * `identity.ts` decides whether a recorded PID is still an OMPChamber server
 * from exactly these answers, so a wrong liveness or a wrong state string
 * silently blocks startup on a free port or, worse, lets a stale record name a
 * stranger as the occupant. Every probe method is contractually "degrade, never
 * throw": a diagnostic question about a PID must not fail a request.
 *
 * The two ends pinned here need no OS-specific setup. A PID that cannot exist
 * must read back `dead`/null/false on every platform. Our own live process must
 * read back `alive`, and a real child whose argv contains a space must read
 * back with that space preserved — the platform probe's parser must not stop at
 * the first whitespace (its own doc comment calls this out for `ps`, whose
 * command column runs to end of line).
 *
 * Linux's `/proc` parsing is not reachable on macOS; only its documented
 * degrade path (no `/proc` entry, so `dead`/null/false) is pinned.
 */

import { describe, expect, test } from 'bun:test';

import { processProbe } from '@/server/lib/lifecycle/proc';
import { darwinProbe } from '@/server/lib/lifecycle/proc/darwin';
import { linuxProbe } from '@/server/lib/lifecycle/proc/linux';
import { psProbe } from '@/server/lib/lifecycle/proc/ps';
import { win32Probe } from '@/server/lib/lifecycle/proc/win32';
import { testPosix } from '@/test-support/platform';

/** Beyond every OS pid ceiling (macOS 99999, Linux pid_max <= 2^22). */
const IMPOSSIBLE_PID = 2_147_483_646;

describe('psProbe', () => {
  testPosix('reads a live process command line with its spaces intact', async () => {
    // `ps -ax -o command=` prints the command column to end of line, so a
    // parser that stopped at the first whitespace would lose `sleep 30`.
    const child = Bun.spawn(['/bin/sh', '-c', 'sleep 30'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    try {
      const command = psProbe.commandLine(child.pid);
      // Absent from the (briefly cached) snapshot means no `ps` on this host:
      // the probe degrades to null rather than inventing an answer.
      if (command !== null) expect(command).toContain('sleep 30');
    } finally {
      child.kill();
      await child.exited;
    }
  });

  test('reports our own process alive and its command line', async () => {
    expect(psProbe.liveness(process.pid)).toBe('alive');
    expect(psProbe.isAlive(process.pid)).toBe(true);
    expect(psProbe.isZombie(process.pid)).toBe(false);
    expect(psProbe.commandLine(process.pid)).toContain('bun');
  });

  test('degrades to dead/null/false for a PID that cannot exist', () => {
    // No `ps` row and no signalable process: the signal check is the fallback,
    // and an unanswerable PID must never be reported alive.
    expect(psProbe.liveness(IMPOSSIBLE_PID)).toBe('dead');
    expect(psProbe.isAlive(IMPOSSIBLE_PID)).toBe(false);
    expect(psProbe.isZombie(IMPOSSIBLE_PID)).toBe(false);
    expect(psProbe.commandLine(IMPOSSIBLE_PID)).toBeNull();
  });

  test('has no foreground group to report from its cached table', () => {
    // `ps -ax -o pid=,stat=,command=` carries no tpgid column; null keeps the
    // caller on its own `ps -o pid=,tpgid=` path rather than guessing.
    expect(psProbe.foregroundGroup(process.pid)).toBeNull();
  });
});

describe('linuxProbe without a /proc entry', () => {
  test('treats a PID with no /proc directory as dead, not unknown', () => {
    expect(linuxProbe.liveness(IMPOSSIBLE_PID)).toBe('dead');
    expect(linuxProbe.isAlive(IMPOSSIBLE_PID)).toBe(false);
    expect(linuxProbe.isZombie(IMPOSSIBLE_PID)).toBe(false);
    expect(linuxProbe.commandLine(IMPOSSIBLE_PID)).toBeNull();
    expect(linuxProbe.foregroundGroup(IMPOSSIBLE_PID)).toBeNull();
  });
});

describe('win32Probe', () => {
  test('never reports a zombie and never reads a command line', () => {
    expect(win32Probe.commandLine(process.pid)).toBeNull();
    expect(win32Probe.isZombie(process.pid)).toBe(false);
    expect(win32Probe.foregroundGroup(process.pid)).toBeNull();
  });

  test('a null command line is what makes identity `unknown`, never `matched`', () => {
    // This is the fact `stopInstance` had to be taught: on Windows the probe
    // cannot read a PID's command line, so identity degrades to `unknown` for
    // every PID — the server's own included. A caller that treats anything but
    // `matched` as "not ours" therefore never signals an OMPChamber server
    // there, which is what made `ompchamber stop` report success over a process
    // that was still listening.
    expect(win32Probe.commandLine(process.pid)).toBeNull();
  });

  test('reduces liveness to signal 0', () => {
    expect(win32Probe.liveness(process.pid)).toBe('alive');
    expect(win32Probe.isAlive(process.pid)).toBe(true);
    expect(win32Probe.liveness(IMPOSSIBLE_PID)).toBe('dead');
    expect(win32Probe.isAlive(IMPOSSIBLE_PID)).toBe(false);
  });
});

describe('processProbe selection', () => {
  test('picks the probe for the running platform', () => {
    const expected = process.platform === 'darwin'
      ? darwinProbe
      : process.platform === 'linux'
        ? linuxProbe
        : process.platform === 'win32'
          ? win32Probe
          : psProbe;
    expect(processProbe).toBe(expected);
  });

  testPosix('reads the command line of a real child, spaces preserved', async () => {
    // The platform probe (libproc on macOS, /proc on Linux) must join argv and
    // keep an argument that itself contains a space.
    //
    // The shell prints before it sleeps, and that line is what says the OS has
    // finished `exec`: reading the command line in the instant between fork and
    // exec sees an EMPTY `/proc/<pid>/cmdline`, and Linux's probe then falls
    // back to `comm` — `sh`, with no `sleep 30` in it. `printf` also keeps the
    // shell in place, so the argv under test is the shell's own.
    const child = Bun.spawn(['/bin/sh', '-c', 'printf ready; sleep 30'], { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' });
    const reader = (child.stdout as ReadableStream<Uint8Array>).getReader();
    try {
      await reader.read();
      expect(processProbe.liveness(child.pid)).toBe('alive');
      const command = processProbe.commandLine(child.pid);
      if (process.platform === 'win32') {
        // Windows cannot reach a foreign command line at all; null, not a guess.
        expect(command).toBeNull();
      } else {
        expect(command).toContain('sleep 30');
      }
    } finally {
      reader.releaseLock();
      child.kill();
      await child.exited;
    }
  });

  test('every probe implements the full ProcessProbe contract', () => {
    for (const probe of [darwinProbe, linuxProbe, win32Probe, psProbe]) {
      expect(typeof probe.commandLine).toBe('function');
      expect(typeof probe.liveness).toBe('function');
      expect(typeof probe.isAlive).toBe('function');
      expect(typeof probe.isZombie).toBe('function');
      expect(typeof probe.foregroundGroup).toBe('function');
    }
  });
});
