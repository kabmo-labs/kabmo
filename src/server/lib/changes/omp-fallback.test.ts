/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The omp journal as the `write` race fallback.
 *
 * omp reads the file inside the tool, before the write, so its `before` blob is
 * exact where Kabmo's start-frame snapshot can lose the race. The three answers
 * matter: a string (the before content), `null` (the file did not exist), and
 * `undefined` (no matching record — the caller must not read that as absent).
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { readOmpBefore } from '@/server/lib/changes/omp-fallback.server';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp/session-scan/files';

const SESSION = 'omp-fallback-1';
let agentDir = '';
let original: string | undefined;

beforeAll(async () => {
  original = Bun.env.PI_CODING_AGENT_DIR;
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-omp-fallback-'));
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  clearSessionFileCaches();

  const projectDir = path.join(agentDir, 'sessions', '-repo');
  await fsp.mkdir(projectDir, { recursive: true });
  const sessionFile = path.join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION}.jsonl`);
  await fsp.writeFile(
    sessionFile,
    `${JSON.stringify({ type: 'session', version: 3, id: SESSION, timestamp: '2026-01-01T00:00:00.000Z', cwd: '/repo' })}\n`,
  );
  const journalDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(path.join(journalDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(journalDir, 'blobs', 'b1'), Bun.gzipSync(Buffer.from('old', 'utf8')));
  await fsp.writeFile(path.join(journalDir, 'blobs', 'b2'), Bun.gzipSync(Buffer.from('new', 'utf8')));
  await fsp.writeFile(
    path.join(journalDir, 'changes.jsonl'),
    [
      JSON.stringify({ type: 'change', at: 1000, agent: 'Main', tool: 'write', path: '/repo/a.ts', before: 'b1', after: 'b2' }),
      JSON.stringify({ type: 'change', at: 2000, agent: 'Main', tool: 'write', path: '/repo/new.ts', before: null, after: 'b2' }),
    ].join('\n') + '\n',
  );
});

afterAll(async () => {
  if (original === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = original;
  clearSessionFileCaches();
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('readOmpBefore', () => {
  test('returns the before content of the matching record', async () => {
    expect(await readOmpBefore(SESSION, '/repo/a.ts', 1000)).toBe('old');
  });

  test('returns null when the file did not exist', async () => {
    expect(await readOmpBefore(SESSION, '/repo/new.ts', 2000)).toBeNull();
  });

  test('returns undefined outside the match window', async () => {
    expect(await readOmpBefore(SESSION, '/repo/a.ts', 20_000)).toBeUndefined();
  });

  test('returns undefined for a path with no record', async () => {
    expect(await readOmpBefore(SESSION, '/repo/missing.ts', 1000)).toBeUndefined();
  });
});
