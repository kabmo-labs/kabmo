import { describe, expect, test } from 'bun:test';

import { planUpdateSteps } from '@/server/lib/updates/install';
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
