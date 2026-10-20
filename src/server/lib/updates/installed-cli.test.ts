/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The copy an update INSTALLED, and how a restart reaches it.
 *
 * The bug these pin is a rename, not a version bump: `bun add -g
 * @kabmo-labs/kabmo` installs a second package beside `ompchamber`, so a
 * restart resolved from the RUNNING copy relaunched the build the update just
 * replaced — measured on the 4.23.1 → 0.0.1 move, where the log showed
 * `.../node_modules/ompchamber/src/cli/ompchamber.js restart --port 3001` and
 * the console came back as the old version.
 *
 * Three facts are pinned here, each of which failed independently:
 *
 * 1. The CLI file comes from the package's own `bin` map, so a copy that names
 *    its bin something other than `kabmo.js` still resolves.
 * 2. A copy is found through Bun's global layout, asked of the installer.
 * 3. The credential marker follows the TARGET package's spelling, because the
 *    rename renamed the variable too.
 */

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyAt, globalNodeModules, nodeModulesForBinDir, resolveInstalledCopy } from '@/server/lib/updates/installed-cli';
import { restartInvocation, scheduleSelfRestart } from '@/server/lib/lifecycle/restart';
import { writeInstanceRecord } from '@/server/lib/lifecycle/instance';
import { executableStub } from '@/test-support/executable-stub';

function fixture(manifest: Record<string, unknown>, files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'installed-cli-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify(manifest));
  for (const file of files) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), '#!/usr/bin/env bun\n');
  }
  return root;
}

describe('copyAt', () => {
  test('resolves the current package through its own bin', () => {
    const root = fixture(
      { name: '@kabmo-labs/kabmo', bin: { kabmo: './src/cli/kabmo.js' } },
      ['src/cli/kabmo.js'],
    );
    try {
      const copy = copyAt(root);
      expect(copy?.packageName).toBe('@kabmo-labs/kabmo');
      expect(copy?.bin).toBe('kabmo');
      // The file name is the package's own, never a guess.
      expect(copy?.cli.endsWith(join('src', 'cli', 'kabmo.js'))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('the bridge release registers both names, and its own one wins', () => {
    // `ompchamber@4.23.x` ships both bins; resolving to whichever key came
    // first would restart a renamed install through the legacy spelling.
    const root = fixture(
      { name: 'ompchamber', bin: { kabmo: './src/cli/kabmo.js', ompchamber: './src/cli/ompchamber.js' } },
      ['src/cli/kabmo.js', 'src/cli/ompchamber.js'],
    );
    try {
      expect(copyAt(root)?.bin).toBe('ompchamber');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a string bin is registered under the unscoped package name', () => {
    const root = fixture({ name: '@kabmo-labs/kabmo', bin: './bin/kabmo.js' }, ['bin/kabmo.js']);
    try {
      expect(copyAt(root)).toMatchObject({ bin: 'kabmo', packageName: '@kabmo-labs/kabmo' });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a declared bin that is not on disk is not a copy', () => {
    const root = fixture({ name: '@kabmo-labs/kabmo', bin: { kabmo: './src/cli/kabmo.js' } }, []);
    try {
      expect(copyAt(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a directory with no manifest is not a copy', () => {
    const root = mkdtempSync(join(tmpdir(), 'installed-cli-empty-'));
    try {
      expect(copyAt(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('nodeModulesForBinDir', () => {
  test('the packages sit one layout step from the bin directory', () => {
    // `<BUN_INSTALL>/bin` → `<BUN_INSTALL>/install/global/node_modules`, the
    // shape `detectInstallMethod` recognizes as a Bun global install. Built
    // with `join`, not written POSIX: `node:path` emits the PLATFORM separator,
    // so a literal expectation fails on Windows with the same path spelled
    // `\home\u\...` (measured on the Windows CI leg).
    const installRoot = join(tmpdir(), 'kabmo-bun-install');
    expect(nodeModulesForBinDir(join(installRoot, 'bin')))
      .toBe(join(installRoot, 'install', 'global', 'node_modules'));
  });
});

describe('globalNodeModules', () => {
  // A COMPILED stub, not a shell script: `Bun.spawn` cannot start a script on
  // Windows (only `.com`/`.exe` are tried), and this suite runs there. The path
  // is baked into the source rather than passed through the environment,
  // because a child does not inherit a `Bun.env` assignment made in-process —
  // and baking it keeps the source constant, so the compiled fixture is cached.
  const binDir = join(tmpdir(), 'kabmo-fake-bun-bin');
  const stubSource = `console.log(${JSON.stringify(binDir)});\n`;

  test('asks the installer and maps its answer', async () => {
    mkdirSync(binDir, { recursive: true });
    const bun = await executableStub(stubSource, 'fake-bun-pm-bin');
    try {
      expect(globalNodeModules(bun)).toBe(nodeModulesForBinDir(binDir));
    } finally {
      rmSync(binDir, { recursive: true, force: true });
    }
  });

  test('a package that is not installed resolves to null', async () => {
    const bun = await executableStub('process.exit(1);\n', 'fake-bun-no-answer');
    expect(resolveInstalledCopy('@kabmo-labs/definitely-absent', bun)).toBeNull();
  });
});

describe('restartInvocation', () => {
  test('runs the installed copy and names its credential marker', () => {
    const root = fixture(
      { name: '@kabmo-labs/kabmo', bin: { kabmo: './src/cli/kabmo.js' } },
      ['src/cli/kabmo.js'],
    );
    try {
      const invocation = restartInvocation(3001, root);
      expect(invocation?.cmd.slice(-3)).toEqual(['restart', '--port', '3001']);
      expect(invocation?.cmd[1].endsWith(join('src', 'cli', 'kabmo.js'))).toBe(true);
      // The renamed build reads KABMO_PASSWORD_HANDOVER; setting only the old
      // spelling would hand it a payload it never looks for.
      expect(invocation?.handoverEnv).toBe('KABMO_PASSWORD_HANDOVER');
      expect(invocation?.root).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a pre-rename copy keeps the old marker', () => {
    const root = fixture(
      { name: 'ompchamber', bin: { ompchamber: './src/cli/ompchamber.js' } },
      ['src/cli/ompchamber.js'],
    );
    try {
      expect(restartInvocation(3001, root)?.handoverEnv).toBe('OMPCHAMBER_PASSWORD_HANDOVER');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a root with no runnable copy yields no invocation', () => {
    const root = mkdtempSync(join(tmpdir(), 'installed-cli-empty-'));
    try {
      expect(restartInvocation(3001, root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('scheduleSelfRestart target', () => {
  test('consults the INSTALLED copy, not the one this process runs from', () => {
    // A rename installs a second package beside the running one, so restarting
    // from this process's own root relaunches the build the update replaced.
    // The refusal names the root it consulted, which is how this is observable
    // without arming a spawn.
    const dataDir = mkdtempSync(join(tmpdir(), 'restart-target-'));
    const previous = Bun.env.KABMO_DATA_DIR;
    Bun.env.KABMO_DATA_DIR = dataDir;
    writeInstanceRecord({
      pid: process.pid,
      port: 4204,
      host: 'localhost',
      mode: 'prod',
      launchMode: 'daemon',
      tray: false,
      tls: false,
      auth: false,
      startedAt: '2026-10-01T10:00:00.000Z',
      version: '0.0.1',
    });
    // A root with no runnable copy: the plan refuses and says WHICH root.
    const installedRoot = mkdtempSync(join(tmpdir(), 'installed-copy-'));
    try {
      const plan = scheduleSelfRestart('update', {
        root: installedRoot,
        packageName: '@kabmo-labs/kabmo',
        bin: 'kabmo',
        cli: join(installedRoot, 'src', 'cli', 'kabmo.js'),
      });
      expect(plan.restarting).toBe(false);
      expect(plan.message).toContain(installedRoot);
    } finally {
      if (previous === undefined) delete Bun.env.KABMO_DATA_DIR;
      else Bun.env.KABMO_DATA_DIR = previous;
      rmSync(installedRoot, { recursive: true, force: true });
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
