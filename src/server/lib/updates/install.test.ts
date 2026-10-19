import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { planUpdateSteps, resolveOmpChamberVersion } from '@/server/lib/updates/install';
import { detectInstallMethod, manualUpdateCommand } from '@/server/lib/updates/install-method';

const checkout = {
  pkgRoot: '/Users/dev/ompchamber',
  gitWorkTree: true,
  gitRemote: 'https://github.com/rajebdev/ompchamber.git',
};

describe('detectInstallMethod', () => {
  test('recognizes a bun global install', () => {
    const info = detectInstallMethod({
      pkgRoot: '/Users/dev/.bun/install/global/node_modules/ompchamber',
      gitWorkTree: false,
      gitRemote: null,
    });
    expect(info.method).toBe('bun-global');
  });

  test('recognizes the bun global layout behind windows separators', () => {
    const info = detectInstallMethod({
      pkgRoot: 'C:\\Users\\dev\\.bun\\install\\global\\node_modules\\ompchamber',
      gitWorkTree: false,
      gitRemote: null,
    });
    expect(info.method).toBe('bun-global');
  });

  test('leaves a package-manager install manual', () => {
    const info = detectInstallMethod({ pkgRoot: '/usr/local/lib/node_modules/ompchamber', gitWorkTree: false, gitRemote: null });
    expect(info.method).toBe('npm');
    // The command is bun's in both manual branches: OMPChamber is a Bun package.
    expect(manualUpdateCommand(info.method, '0.3.0')).toBe('bun add -g ompchamber@0.3.0');
    // The resolved target is the package an update actually installs; after the
    // rename that is `kabmo`, and a copy on the old name must still be told so.
    expect(manualUpdateCommand(info.method, '5.0.0', 'kabmo')).toBe('bun add -g kabmo@5.0.0');
  });

  test('treats a checkout of the repository as updatable over git', () => {
    expect(detectInstallMethod(checkout).method).toBe('git');
    expect(detectInstallMethod({ ...checkout, gitRemote: 'git@github.com:rajebdev/ompchamber.git' }).method).toBe('git');
  });

  test('recognizes the renamed repository in both spellings', () => {
    expect(detectInstallMethod({ ...checkout, gitRemote: 'https://github.com/kabmo-labs/kabmo.git' }).method).toBe('git');
    expect(detectInstallMethod({ ...checkout, gitRemote: 'git@github.com:kabmo-labs/kabmo.git' }).method).toBe('git');
  });

  test('leaves a checkout tracking another remote manual', () => {
    const info = detectInstallMethod({ ...checkout, gitRemote: 'https://github.com/rajebdev/ompchamber-fork.git' });
    expect(info.method).toBe('unmanaged');
    expect(manualUpdateCommand(info.method, '0.3.0')).toBe('bun add -g ompchamber@0.3.0');
  });

  test('leaves a source copy without git metadata manual', () => {
    const info = detectInstallMethod({ pkgRoot: '/opt/src/ompchamber', gitWorkTree: false, gitRemote: null });
    expect(info.method).toBe('unmanaged');
    expect(manualUpdateCommand(info.method, null)).toBe('bun add -g ompchamber@latest');
  });
});

describe('planUpdateSteps', () => {
  const params = { version: '0.3.0', pkgRoot: '/Users/dev/ompchamber', bunBin: '/Users/dev/.bun/bin/bun' };

  test('installs the release version for a bun global install', () => {
    const steps = planUpdateSteps({ ...params, method: 'bun-global' });
    expect(steps.map((step) => step.cmd.join(' '))).toEqual(['/Users/dev/.bun/bin/bun add -g ompchamber@0.3.0']);
  });

  test('installs the renamed package when the resolved target says so', () => {
    const steps = planUpdateSteps({ ...params, method: 'bun-global', packageName: 'kabmo' });
    expect(steps.map((step) => step.cmd.join(' '))).toEqual(['/Users/dev/.bun/bin/bun add -g kabmo@0.3.0']);
  });

  test('fast-forwards a checkout to the release tag and rebuilds, without discarding local work', () => {
    const steps = planUpdateSteps({ ...params, method: 'git' });
    const commands = steps.map((step) => step.cmd.join(' '));

    expect(commands).toContain('git -C /Users/dev/ompchamber fetch --tags origin');
    expect(commands).toContain('git -C /Users/dev/ompchamber merge --ff-only v0.3.0');
    expect(commands).toContain('/Users/dev/.bun/bin/bun install');
    expect(commands).toContain('/Users/dev/.bun/bin/bun run build');
    expect(commands.some((command) => /(push|reset|checkout|stash|clean)\b/.test(command))).toBe(false);
    expect(steps.every((step) => step.cwd === '/Users/dev/ompchamber')).toBe(true);
  });
});

describe('resolveOmpChamberVersion', () => {
  const runnerFetch = Bun.fetch;
  let dir = '';

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kabmo-version-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'ompchamber', version: '4.23.0' }));
  });

  afterEach(() => {
    globalThis.fetch = runnerFetch;
    rmSync(dir, { recursive: true, force: true });
  });

  test('a package rename is an update even when its version is lower', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/kabmo/latest')) return new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const info = await resolveOmpChamberVersion(dir);
    expect(info.package).toBe('kabmo');
    expect(info.renamed).toBe(true);
    // 1.0.0 is LOWER than 4.23.0, and semver alone would offer nothing.
    expect(info.updateAvailable).toBe(true);
  });

  test('the same package keeps the semver comparison', async () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'kabmo', version: '1.0.0' }));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/kabmo/latest')) return new Response(JSON.stringify({ version: '1.0.0' }), { status: 200 });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const info = await resolveOmpChamberVersion(dir);
    expect(info.renamed).toBe(false);
    expect(info.updateAvailable).toBe(false);
  });
});
