/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the settings card's launch box is told about the agent.
 *
 * The box advertised `agy acp` on every card — Antigravity's line, printed on
 * omp's and Claude's too — and its hint quoted the INSTALL command as "the
 * built-in line". A user typing that hint's example launches nothing, and the
 * form's placeholder claimed a command this harness does not run.
 *
 * So the catalog now carries the line the spawn would actually run, and this
 * pins it to the launch table itself rather than to a second copy.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { HARNESS_LAUNCH } from '@/server/lib/harness/launch-table';
import { listHarnesses } from '@/server/routes/harness/root';

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('the catalog carries each harness’s own launch line', () => {
  test('every harness with a launch entry reports that entry’s command', async () => {
    const rows = new Map((await listHarnesses()).map((row) => [row.id, row]));
    for (const [id, launch] of Object.entries(HARNESS_LAUNCH)) {
      if (!launch) continue;
      expect(rows.get(id)?.command, id).toBe(launch.command.join(' '));
    }
  });

  test('omp and Claude name their own binaries, not Antigravity’s', async () => {
    const rows = new Map((await listHarnesses()).map((row) => [row.id, row]));
    expect(rows.get('omp-acp')?.command).toBe('omp acp');
    expect(rows.get('claude')?.command).toBe(
      'npx -y @agentclientprotocol/claude-agent-acp@0.100.0',
    );
    // The install line is a different fact and must not stand in for the command.
    expect(rows.get('omp-acp')?.command).not.toBe(rows.get('omp-acp')?.install);
  });
});
