/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a run's executable comes from, when the host itself was started with
 * almost no PATH.
 *
 * This is the reported failure: a Kabmo started by launchd (the desktop app, a
 * LaunchAgent, `--launch-mode=daemon`) inherits
 * `/usr/bin:/bin:/usr/sbin:/sbin`, so `Bun.spawn` answered
 * `Executable not found in $PATH: "bun"` for every row in the Command Runner
 * panel — while the same command in the user's terminal ran, because a terminal
 * launches a LOGIN shell that re-reads the profile and a plugin's `Bun.spawn`
 * has no profile to read.
 *
 * The run is driven against a REAL process for the same reason the lifecycle
 * suite is: the property under test is "the OS found and started this binary",
 * which no fake spawn can show.
 */

import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { onlyRun, makeRegistry, waitFor, SCOPE } from './runner-harness';

/**
 * Both cases are POSIX-only, for the two reasons `src/test-support/platform.ts`
 * names — a plugin cannot import it, so the guard is the same one
 * `runner.test.ts` uses beside it:
 *
 * - the probe is a `#!/bin/sh` stub whose only "executability" is mode `0o755`,
 *   and `CreateProcess` cannot start that file;
 * - the repair under test is itself a no-op on Windows (`toolchainPathDirs`
 *   returns nothing there), so there is no PATH to assert about.
 *
 * A skip is named in the log rather than weakened into an assertion that passes
 * on both platforms while proving nothing.
 */
const testPosix = process.platform === 'win32' ? test.skip : test;

describe('RunRegistry executable resolution', () => {
  testPosix('a command resolves when the host PATH has no toolchain directories', async () => {
    // The probe binary exists ONLY under `$HOME/.bun/bin`, which the inherited
    // PATH does not name, so a resolved run proves the repair appended it.
    const home = mkdtempSync(join(tmpdir(), 'cr-path-'));
    const bin = join(home, '.bun', 'bin');
    mkdirSync(bin, { recursive: true });
    const tool = join(bin, 'cr-probe-tool');
    writeFileSync(tool, '#!/bin/sh\necho probe-ok\n');
    chmodSync(tool, 0o755);
    const env = { PATH: '/usr/bin:/bin', HOME: home };

    try {
      const { registry } = makeRegistry({}, env);
      const started = await registry.start({
        id: 'path',
        sessionId: null,
        scopeKey: SCOPE,
        commandId: 'x#package:probe',
        file: 'package.json',
        cwd: home,
        argv: ['cr-probe-tool'],
        label: 'cr-probe-tool',
        background: false,
      });
      expect(started).toEqual({ runId: 'path' });
      await waitFor(() => onlyRun(registry.state()).status !== 'running');
      expect(onlyRun(registry.state()).status).toBe('exited');
      expect(registry.log('path', 4096)!.text).toContain('probe-ok');

      // The repair has to reach the CHILD too, not just the spawn: `bun run dev`
      // resolves `vite` from the PATH its own process was given.
      const { registry: shell } = makeRegistry({}, env);
      await shell.start({
        id: 'path-child',
        sessionId: null,
        scopeKey: SCOPE,
        commandId: 'x#package:path',
        file: 'package.json',
        cwd: home,
        argv: ['sh', '-c', 'echo "CHILD_PATH=$PATH"'],
        label: 'path probe',
        background: false,
      });
      await waitFor(() => onlyRun(shell.state()).status !== 'running');
      const childPath = /CHILD_PATH=(.*)/.exec(shell.log('path-child', 4096)!.text)?.[1] ?? '';
      const segments = childPath.trim().split(':');
      expect(segments).toContain(bin);
      // The inherited entries keep their precedence.
      expect(segments.slice(0, 2)).toEqual(['/usr/bin', '/bin']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 20_000);

  testPosix('a name that is already a path is left alone', async () => {
    // A detector may write `./scripts/build.sh`; resolving that against PATH
    // would run a different file than the one the command names.
    const dir = mkdtempSync(join(tmpdir(), 'cr-path-rel-'));
    const script = join(dir, 'run-me.sh');
    writeFileSync(script, '#!/bin/sh\necho relative-ok\n');
    chmodSync(script, 0o755);
    try {
      const { registry } = makeRegistry({}, { PATH: '/usr/bin:/bin', HOME: dir });
      await registry.start({
        id: 'relative',
        sessionId: null,
        scopeKey: SCOPE,
        commandId: 'x#make:relative',
        file: 'Makefile',
        cwd: dir,
        argv: ['./run-me.sh'],
        label: './run-me.sh',
        background: false,
      });
      await waitFor(() => onlyRun(registry.state()).status !== 'running');
      expect(onlyRun(registry.state()).status).toBe('exited');
      expect(registry.log('relative', 4096)!.text).toContain('relative-ok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
