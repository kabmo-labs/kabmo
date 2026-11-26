/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two journal routes' guards: a missing or unsafe session id, a diff read
 * without its range, and a path with no record in the range. The data itself is
 * covered by `changes.test.ts`; this file pins the HTTP answers a stale click
 * or a crafted id receives.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import type { LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';
import { getSessionChangeDiff, getSessionChanges } from '@/server/routes/sessions/changes';

const SESSION_ID = '01a0cc50-fd62-7417-899c-e24ff8c8608c';
let CWD = '';
let agentDir = '';
let journalDir = '';

function args(sessionId: string | undefined, query = ''): LoaderFunctionArgs {
  return {
    params: sessionId === undefined ? {} : { sessionId },
    request: new Request(`http://localhost/api/sessions/${sessionId ?? ''}/changes${query}`),
    context: {},
  } as unknown as LoaderFunctionArgs;
}

beforeAll(async () => {
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'omp-changes-route-'));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  CWD = path.join(agentDir, 'project');
  await fsp.mkdir(CWD, { recursive: true });
  // The list drops a creation whose file is gone, so the kept one must exist.
  await fsp.writeFile(path.join(CWD, 'a.ts'), 'one\n');
  const cwdDir = path.join(agentDir, 'sessions', '-tmp-project');
  await fsp.mkdir(cwdDir, { recursive: true });
  const sessionFile = path.join(cwdDir, `2026-01-01T00-00-00-000Z_${SESSION_ID}.jsonl`);
  await fsp.writeFile(
    sessionFile,
    `${JSON.stringify({ type: 'session', version: 3, id: SESSION_ID, timestamp: '2026-01-01T00:00:00.000Z', cwd: CWD })}\n`,
  );
  journalDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(path.join(journalDir, 'blobs'), { recursive: true });
  const after = 'a1';
  await fsp.writeFile(path.join(journalDir, 'blobs', after), Bun.gzipSync(Buffer.from('one\n', 'utf8')));
  await fsp.writeFile(
    path.join(journalDir, 'changes.jsonl'),
    [
      JSON.stringify({ type: 'change', at: 1000, agent: 'Main', tool: 'write', path: `${CWD}/a.ts`, before: null, after }),
      // Created then `rm`'d: the journal has no delete record, so the list must
      // drop it by checking the path.
      JSON.stringify({ type: 'change', at: 1001, agent: 'Main', tool: 'write', path: `${CWD}/gone.ts`, before: null, after }),
    ].join('\n') + '\n',
  );
  clearSessionFileCaches();
});

afterAll(async () => {
  delete process.env.PI_CODING_AGENT_DIR;
  clearSessionFileCaches();
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('getSessionChanges', () => {
  test('answers the records for a real session, minus a creation whose file is gone', async () => {
    const response = (await getSessionChanges(args(SESSION_ID))) as Response;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: Array<{ displayPath: string }> };
    expect(body.records.map((record) => record.displayPath)).toEqual(['a.ts']);
  });

  test('a missing id is a 400, an unsafe id a 404', async () => {
    expect(((await getSessionChanges(args(undefined))) as Response).status).toBe(400);
    expect(((await getSessionChanges(args('../escape'))) as Response).status).toBe(404);
  });
});

describe('getSessionChangeDiff', () => {
  test('answers the net change for a path in range', async () => {
    const query = `?path=${encodeURIComponent(`${CWD}/a.ts`)}&from=1000&to=1000`;
    const response = (await getSessionChangeDiff(args(SESSION_ID, query))) as Response;
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; newContent: string };
    expect(body.status).toBe('added');
    expect(body.newContent).toBe('one\n');
  });

  test('a missing range is a 400, an unknown path a 404', async () => {
    expect(((await getSessionChangeDiff(args(SESSION_ID, '?path=x'))) as Response).status).toBe(400);
    const query = `?path=${encodeURIComponent(`${CWD}/nope.ts`)}&from=1&to=2`;
    expect(((await getSessionChangeDiff(args(SESSION_ID, query))) as Response).status).toBe(404);
  });
});
