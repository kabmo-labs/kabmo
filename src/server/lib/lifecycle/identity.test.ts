/**
 * Which command lines count as this product.
 *
 * The port guard, `stop`, `restart` and update ownership all key off this
 * predicate, and a server installed under the new name must not be mistaken for
 * a stranger just because the old name is gone from its path.
 */

import { describe, expect, test } from 'bun:test';

import { isChamberCommand } from '@/server/lib/lifecycle/identity';

describe('isChamberCommand', () => {
  test('matches a server installed under either name', () => {
    expect(isChamberCommand('bun /Users/x/.bun/install/global/node_modules/ompchamber/src/server/index.ts')).toBe(true);
    expect(isChamberCommand('bun /Users/x/.bun/install/global/node_modules/kabmo/src/server/index.ts')).toBe(true);
    expect(isChamberCommand('bun /x/kabmo/dist/client/index.js --kabmo-server')).toBe(true);
  });

  test('does not claim a foreign process', () => {
    expect(isChamberCommand('node /opt/app/server.js')).toBe(false);
  });
});
