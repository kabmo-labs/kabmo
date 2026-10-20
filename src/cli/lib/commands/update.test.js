// The context `kabmo update` restarts from.
//
// Pinned because getting it wrong is silent and expensive: after a RENAME the
// installed package is a different directory from the one this command runs
// out of, and restarting from `ctx.pkgRoot` relaunches the build the update
// just replaced. Measured on the 4.23.1 → 0.0.1 move: the console came back as
// the old version while the update reported success.

import { describe, expect, test } from 'bun:test';

import { restartCtx } from '@/cli/lib/commands/update.js';

const ctx = { cwd: '/work', pkgRoot: '/global/node_modules/ompchamber', version: '4.23.1', bin: 'ompchamber' };

describe('restartCtx', () => {
  test('spawns the replacement from the copy the update installed', () => {
    const installed = {
      root: '/global/node_modules/@kabmo-labs/kabmo',
      packageName: '@kabmo-labs/kabmo',
      bin: 'kabmo',
      cli: '/global/node_modules/@kabmo-labs/kabmo/src/cli/kabmo.js',
    };
    expect(restartCtx(ctx, installed)).toEqual({
      ...ctx,
      pkgRoot: '/global/node_modules/@kabmo-labs/kabmo',
      bin: 'kabmo',
    });
  });

  test('keeps this command\u2019s own root when the update reported none', () => {
    // A checkout, or a run whose install could not be read: the copy that was
    // updated IS this one, so nothing moves.
    expect(restartCtx(ctx, null)).toBe(ctx);
    expect(restartCtx(ctx, { root: '' })).toBe(ctx);
  });
});
