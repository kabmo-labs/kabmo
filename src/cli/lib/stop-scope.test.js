/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { partitionStopTargets } from '@/cli/lib/stop-scope.js';

const daemon = { port: 3000, pid: 11, launchMode: 'daemon' };
const foreground = { port: 3001, pid: 12, launchMode: 'foreground' };
const dev = { port: 3002, pid: 13, launchMode: 'direct' };
const unknown = { port: 3003, pid: 14, launchMode: 'unknown' };

describe('partitionStopTargets', () => {
  // The default scope is ownership, not "everything that answers /api/health".
  // `bun run dev` is a supervisor whose only job is to mirror the script under
  // it, so stopping that server exits the user's dev loop too — the bug this
  // rule exists to prevent.
  test('stops only the instances the CLI started when the scope is implicit', () => {
    const { targets, skipped } = partitionStopTargets([daemon, dev, foreground, unknown], false);
    expect(targets).toEqual([daemon, foreground]);
    expect(skipped).toEqual([dev, unknown]);
  });

  // Naming an instance — a port or `--all` — is a deliberate call, so the
  // ownership rule no longer gates it.
  test('widens to every instance when the scope is explicit', () => {
    const { targets, skipped } = partitionStopTargets([daemon, dev, unknown], true);
    expect(targets).toEqual([daemon, dev, unknown]);
    expect(skipped).toEqual([]);
  });

  test('an unreadable launch mode is never stopped implicitly', () => {
    // A record whose launchMode could not be read must not authorise a kill:
    // the safe reading is "not ours".
    const { targets, skipped } = partitionStopTargets([{ port: 4000, pid: 99, launchMode: undefined }], false);
    expect(targets).toEqual([]);
    expect(skipped.length).toBe(1);
  });
});
