/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which sessions share a cwd, from each journal's `session` header.
 *
 * The scan's cross-check depends on this: a path another session in the same
 * cwd already recorded must not be attributed to the current command.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import { sessionsInCwd } from '@/server/lib/changes/sessions.server';

let dataDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.KABMO_DATA_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-sessions-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  const a = new ChangeJournal('sess-a', '/repo');
  const b = new ChangeJournal('sess-b', '/repo');
  const c = new ChangeJournal('sess-c', '/other');
  await a.recordNote({ at: 1, reason: 'opaque-command' });
  await b.recordNote({ at: 1, reason: 'opaque-command' });
  await c.recordNote({ at: 1, reason: 'opaque-command' });
  await Promise.all([a.flush(), b.flush(), c.flush()]);
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = original;
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('sessionsInCwd', () => {
  test('returns the other sessions in the same cwd', async () => {
    expect((await sessionsInCwd('/repo', 'sess-a')).sort()).toEqual(['sess-b']);
    expect((await sessionsInCwd('/repo', 'sess-x')).sort()).toEqual(['sess-a', 'sess-b']);
  });

  test('does not mix a different cwd', async () => {
    expect(await sessionsInCwd('/other', 'sess-a')).toEqual(['sess-c']);
    expect(await sessionsInCwd('/none', 'sess-a')).toEqual([]);
  });
});
