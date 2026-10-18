/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run registry, driven against REAL processes.
 *
 * A fake `Bun.spawn` would prove nothing here: the three mechanics this file
 * exists for are all properties of the OS and of Bun, and each was measured
 * before it was written down.
 *
 * - **`detached: true` + `process.kill(-pid, SIG)` kills the whole tree.** A
 *   shell that forked a child keeps the pipe open, so a kill that reached only
 *   the shell would leave the read blocked — the failure shows up as a `stop`
 *   that never settles.
 * - **A killed child reports `exitCode: null` and a SIGNAL.** Reading a null code
 *   as `exit 0` reports a killed run as a success, which is the bug the summary's
 *   `signal` field exists to prevent.
 * - **A missing binary THROWS from `Bun.spawn`** rather than producing a child
 *   with a non-zero code, so the catch is the only path that reports it.
 *
 * The ring is tested with a run that prints more than it holds, because the
 * distinction between `bytes` (everything produced) and `ringBytes` (what is
 * kept) is what lets the view say "the last 64 KB of 3.1 MB" rather than
 * presenting a window as the whole log.
 */

import { describe, expect, test } from 'bun:test';

import { RunRegistry } from './runner';
import { scopeKeyOf } from './run-store';
import { RUN_BUFFER_BYTES, ringText, stripAnsi } from './ring';
import type { RunnerState } from '../protocol';

/** A registry whose publish/log/setting calls are recorded instead of sent. */
function makeRegistry(settings: Record<string, unknown> = {}) {
  const published: RunnerState[] = [];
  const logs: string[] = [];
  const registry = new RunRegistry({
    publish: (state) => published.push(state),
    log: (message) => logs.push(message),
    setting: async <T extends string | number | boolean>(key: string) => settings[key] as T | undefined,
  });
  return { registry, published, logs };
}

/**
 * Wait for a condition, so a test never sleeps for a FIXED time.
 *
 * The clock is real here on purpose, and this is the documented exception:
 * every condition below is "an actual OS process reached a state" — a `sleep 30`
 * child that the group kill reaped, a pipe that drained. Fake timers cannot
 * advance a real process, and awaiting the registry's own promise is not
 * possible because it deliberately keeps no per-run promise (a panel reads state,
 * it does not await a run). The poll interval is 10 ms and the bound is generous,
 * so a pass costs milliseconds and a failure names the condition.
 */
async function waitFor(done: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (done()) return;
    if (Date.now() >= deadline) throw new Error('waitFor timed out');
    const gate = Promise.withResolvers<void>();
    setTimeout(gate.resolve, 10);
    await gate.promise;
  }
}

const SCOPE = scopeKeyOf('/ws', '.');

/** The run a registry holds, by its only id. */
function onlyRun(state: RunnerState) {
  expect(state.runs).toHaveLength(1);
  return state.runs[0];
}

describe('RunRegistry', () => {
  test('runs a command and records its output and exit code', async () => {
    const { registry, published } = makeRegistry();
    const started = await registry.start({
      id: 'run-1',
      sessionId: 's1',
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'package.json',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'echo hello; echo oops >&2'],
      label: 'echo hello',
      background: false,
    });
    expect(started).toEqual({ runId: 'run-1' });

    await waitFor(() => onlyRun(registry.state()).status !== 'running');

    const run = onlyRun(registry.state());
    expect(run.status).toBe('exited');
    expect(run.exitCode).toBe(0);
    expect(run.signal).toBeNull();

    const log = registry.log('run-1', 64 * 1024)!;
    // Both pipes land in one buffer, so a failure is visible beside its cause.
    expect(log.text).toContain('hello');
    expect(log.text).toContain('oops');
    expect(log.truncated).toBe(false);

    // The topic was published on start and on exit.
    expect(published.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  test('a non-zero exit is a failed run with its code', async () => {
    const { registry } = makeRegistry();
    await registry.start({
      id: 'run-2',
      sessionId: null,
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'Makefile',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'exit 3'],
      label: 'exit 3',
      background: false,
    });
    await waitFor(() => onlyRun(registry.state()).status !== 'running');
    const run = onlyRun(registry.state());
    expect(run.status).toBe('failed');
    expect(run.exitCode).toBe(3);
  }, 20_000);

  test('a missing binary is reported, and the spawn throw is the only path', async () => {
    const { registry, logs } = makeRegistry();
    const started = await registry.start({
      id: 'run-3',
      sessionId: null,
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'Makefile',
      cwd: process.cwd(),
      argv: ['definitely-not-a-real-binary-xyz'],
      label: 'nope',
      background: false,
    });

    expect('error' in started).toBe(true);
    if (!('error' in started)) throw new Error('unreachable');
    expect(started.error).toContain('Failed to start definitely-not-a-real-binary-xyz');

    const run = onlyRun(registry.state());
    expect(run.status).toBe('failed');
    // The reason names the BINARY, not an empty row.
    expect(run.error).toContain('Failed to start');
    expect(logs.length).toBeGreaterThan(0);
  }, 20_000);

  // POSIX-only: the kill targets the process GROUP (`process.kill(-pid)`), which
  // Windows does not have — the plugin's win32 path uses `taskkill /t` and is
  // covered by the chamber's own `killChildTree` suite.
  const testPosix = process.platform === 'win32' ? test.skip : test;
  testPosix('stop kills the whole process group, not just the shell', async () => {
    const { registry } = makeRegistry();
    // The `sleep` is a CHILD of the shell. A kill that reached only the shell
    // would leave it running and the read open, so this hangs if the group is
    // not signalled — which is the property under test.
    await registry.start({
      id: 'run-4',
      sessionId: 's1',
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'package.json',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'echo starting; sleep 30'],
      label: 'sleep 30',
      background: true,
    });

    await waitFor(() => registry.log('run-4', 1024)?.text.includes('starting') ?? false);

    const stopped = await registry.stop('run-4');
    expect(stopped).toEqual({ stopped: true });
    await waitFor(() => onlyRun(registry.state()).status !== 'running');

    const run = onlyRun(registry.state());
    expect(run.status).toBe('stopped');
    // A killed child has NO exit code. Reading the null as `exit 0` would report
    // a killed run as a success.
    expect(run.exitCode).toBeNull();
    expect(run.signal).not.toBeNull();
  }, 30_000);

  test('stopping an unknown or finished run is a no-op, not an error', async () => {
    const { registry } = makeRegistry();
    expect(await registry.stop('nope')).toEqual({ stopped: false });
  });

  test('the capacity cap refuses with a reason instead of queueing', async () => {
    const { registry } = makeRegistry({ maxRuns: 2 });
    for (const id of ['a', 'b']) {
      await registry.start({
        id,
        sessionId: null,
        scopeKey: SCOPE,
        commandId: 'x#make:y',
        file: 'Makefile',
        cwd: process.cwd(),
        argv: ['sh', '-c', 'sleep 30'],
        label: `sleep ${id}`,
        background: true,
      });
    }

    const refused = await registry.start({
      id: 'c',
      sessionId: null,
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'Makefile',
      cwd: process.cwd(),
      argv: ['sh', '-c', 'echo nope'],
      label: 'nope',
      background: true,
    });
    expect('error' in refused).toBe(true);
    if (!('error' in refused)) throw new Error('unreachable');
    expect(refused.error).toContain('at_capacity');

    await registry.dispose();
  }, 30_000);

  test('the ring keeps a tail and reports the true total', async () => {
    const { registry } = makeRegistry();
    // More than the ring holds, so `bytes > ringBytes` and the tail is a window.
    const bytes = RUN_BUFFER_BYTES + 64 * 1024;
    await registry.start({
      id: 'big',
      sessionId: null,
      scopeKey: SCOPE,
      commandId: 'x#make:y',
      file: 'package.json',
      cwd: process.cwd(),
      argv: ['sh', '-c', `head -c ${bytes} /dev/zero | tr '\\0' 'x'; echo END`],
      label: 'big output',
      background: false,
    });
    await waitFor(() => onlyRun(registry.state()).status !== 'running');

    const run = onlyRun(registry.state());
    expect(run.bytes).toBeGreaterThan(RUN_BUFFER_BYTES);
    expect(run.ringBytes).toBeLessThanOrEqual(RUN_BUFFER_BYTES);

    const log = registry.log('big', 64 * 1024)!;
    expect(log.truncated).toBe(true);
    // The tail is the END of the output, which is what a reader wants.
    expect(log.text).toContain('END');
    expect(log.text.length).toBeLessThanOrEqual(64 * 1024);
  }, 30_000);

  test('the chamber host env is not inherited by the command', async () => {
    // The reported bug: the Runner panel's `bun run dev` failed with "Port 3001
    // is already served by OMPChamber" because this plugin's server half runs
    // INSIDE the chamber's process, so the `Bun.env` it spawns with is the
    // CHAMBER's — `PORT` was the port the chamber itself listens on. The same
    // command in a plain terminal (where `PORT` is unset) ran on 3000.
    //
    // `HOST` rides along for the same reason and was missed: the CLI sets it
    // beside PORT (`buildServeInvocation`), so a command inherited the chamber's
    // bind address. Measured through a live chamber started with
    // `HOST=127.0.0.1`: a run reported `HOST=127.0.0.1` while a plain terminal
    // had it unset.
    const saved = { PORT: Bun.env.PORT, HOST: Bun.env.HOST, NODE_ENV: Bun.env.NODE_ENV };
    Bun.env.PORT = '3001';
    Bun.env.HOST = '0.0.0.0';
    Bun.env.NODE_ENV = 'production';
    try {
      const { registry } = makeRegistry();
      await registry.start({
        id: 'env',
        sessionId: null,
        scopeKey: SCOPE,
        commandId: 'x#package:dev',
        file: 'package.json',
        cwd: process.cwd(),
        argv: ['sh', '-c', 'echo "PORT=[$PORT] HOST=[$HOST] NODE_ENV=[$NODE_ENV] PATH_SET=[${PATH:+yes}]"'],
        label: 'env probe',
        background: false,
      });
      await waitFor(() => onlyRun(registry.state()).status !== 'running');

      const text = registry.log('env', 4096)!.text;
      // The command must see what a plain terminal would: no PORT, no HOST, no
      // NODE_ENV.
      expect(text).toContain('PORT=[] HOST=[] NODE_ENV=[]');
      // And the rest of the environment still passes through, or PATH would be
      // gone and every command in the panel would fail to resolve.
      expect(text).toContain('PATH_SET=[yes]');
    } finally {
      if (saved.PORT === undefined) delete Bun.env.PORT;
      else Bun.env.PORT = saved.PORT;
      if (saved.HOST === undefined) delete Bun.env.HOST;
      else Bun.env.HOST = saved.HOST;
      if (saved.NODE_ENV === undefined) delete Bun.env.NODE_ENV;
      else Bun.env.NODE_ENV = saved.NODE_ENV;
    }
  }, 20_000);

  test('an unknown run id answers null, so the route can 404', async () => {
    const { registry } = makeRegistry();
    expect(registry.log('nope', 1024)).toBeNull();
  });
});

describe('ringText', () => {
  test('returns the last N bytes of the ring', () => {
    expect(ringText({ chunks: [Buffer.from('abcdefghij')], held: 10 }, 4)).toBe('ghij');
  });

  test('returns everything when the tail is larger than the buffer', () => {
    expect(ringText({ chunks: [Buffer.from('abc')], held: 3 }, 1024)).toBe('abc');
  });
});

describe('stripAnsi', () => {
  test('removes colour and cursor sequences', () => {
    // What a coloured build actually emits, including a 256-colour code.
    expect(stripAnsi('\u001b[0m\u001b[2;38;5;11m$\u001b[0m make build')).toBe('$ make build');
  });

  test('removes an OSC sequence terminated by BEL', () => {
    expect(stripAnsi('\u001b]0;title\u0007plain')).toBe('plain');
  });

  test('leaves ordinary text alone', () => {
    expect(stripAnsi('12 pass · 0 fail')).toBe('12 pass · 0 fail');
  });
});

