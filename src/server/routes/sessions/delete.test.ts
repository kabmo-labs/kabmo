/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The delete route's refusal branches.
 *
 * Each one guards a different failure, and two of them are about blast radius
 * rather than tidiness: the id names a directory under the sessions root and
 * another under the btw root, so a value that is not one segment deletes far
 * more than the session it names (`.` normalized to the btw root itself and
 * wiped every session's side questions — see `fs/path-segment`).
 *
 * The route is called directly, as the other route tests do: these are pure
 * request-shape checks that must not reach the filesystem or spawn an omp
 * child, and asserting that is half the point.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import path from 'path';
import { deleteSession } from '@/server/routes/sessions/delete';

/**
 * The 404 branch resolves the id by scanning the sessions directory, so the
 * agent dir is pointed at an empty temp tree. Without this the test walks the
 * developer's real `~/.omp/agent/sessions` (read-only, but seconds of I/O and a
 * result that depends on what happens to be installed).
 */
const AGENT_DIR = '/tmp/omc-delete-route-test/agent';

beforeAll(() => {
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(AGENT_DIR, 'sessions'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = AGENT_DIR;
});

afterAll(() => {
  delete Bun.env.PI_CODING_AGENT_DIR;
  fs.rmSync('/tmp/omc-delete-route-test', { recursive: true, force: true });
});

function del(sessionId: string): Promise<Response> {
  return deleteSession({
    request: new Request(`http://localhost/api/sessions/${sessionId}`, { method: 'DELETE' }),
    params: { sessionId },
  } as never) as Promise<Response>;
}

describe('deleteSession refusals', () => {
  test('a pending chat is refused — nothing is stored for it yet', async () => {
    const res = await del('new-1758800000000');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'session_pending' });
  });

  test('`.` is refused instead of wiping the btw root', async () => {
    const res = await del('.');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'Invalid session id' });
  });

  test('a traversal is refused', async () => {
    for (const id of ['..', '../x', 'a/b', '..\\a']) {
      expect((await del(id)).status).toBe(400);
    }
  });

  test('an unknown but well-formed id is a 404, not a 400', async () => {
    // Distinct from the branches above: the request is valid, the session is
    // not there. Collapsing the two would report a typo as a malformed request.
    const res = await del('00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });

  test('a wrong verb on the path is a 405', async () => {
    const res = (await deleteSession({
      request: new Request('http://localhost/api/sessions/x', { method: 'GET' }),
      params: { sessionId: 'x' },
    } as never)) as Response;
    expect(res.status).toBe(405);
  });
});
