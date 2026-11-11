/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { sendCommand } from '@/server/routes/agent/command';
import { saveHarnessConfig } from '@/server/lib/harness/config.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { EMPTY_HARNESS_CONFIG } from '@/shared/lib/harness/config';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';

function post(sessionId: string, body: Record<string, unknown>): Promise<Response> {
  return sendCommand({
    params: { sessionId },
    request: new Request(`http://localhost/api/agent/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  } as never) as Promise<Response>;
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * Continuing a chat whose agent writes no session file.
 *
 * `acpRowsFor` LISTS those chats, and every command sent to one answered
 * `{"error":"Session not found"}` after a restart: this route resumes over RPC,
 * which resolves a `.jsonl` path — and an ACP agent writes none. Measured on a
 * `claude` chat whose row was in the sidebar: both `prompt` and `get_state`
 * answered 404. Its own agent can restore the conversation, so the route
 * respawns it on that harness and dispatches there.
 */
describe('resuming a recorded non-omp chat', () => {
  const RETIRED = 'resume-retired-harness';
  const UNLAUNCHABLE = 'resume-unlaunchable-harness';
  const MISSING = '/nonexistent/kabmo-test-agent';

  beforeEach(async () => {
    await isolateDb();
  });

  afterEach(async () => {
    await releaseDb();
  });

  test('a retired harness id spawns NOTHING and refuses by name', async () => {
    // `opencode2` is out of this build's catalog: a stale row must not be
    // guessed at. The id is kept (a user-added harness has no static descriptor
    // either), so the refusal names the missing launch line instead of the
    // misleading "Session not found" — and no process is spawned.
    await saveHarnessSession({ sessionId: RETIRED, harness: 'opencode2', agentSessionId: RETIRED, cwd: '/tmp' });
    const response = await post(RETIRED, { type: 'prompt', message: 'hello' });
    expect(response.status).toBe(400);
    const body = await payload(response);
    const message = typeof body.error === 'string' ? body.error : '';
    expect(message).toContain('opencode2');
    expect(message).not.toContain('Session not found');
  });

  test('a recorded non-omp chat is respawned on ITS OWN harness', async () => {
    await saveHarnessSession({ sessionId: UNLAUNCHABLE, harness: 'pi', agentSessionId: 'agent-7', cwd: '/tmp' });
    // A launch line that cannot exist, so the case is deterministic on a machine
    // where `pi` IS installed: what it proves is WHICH path ran, not that a
    // binary is missing.
    await saveHarnessConfig('pi', { ...EMPTY_HARNESS_CONFIG, command: MISSING });

    const response = await post(UNLAUNCHABLE, { type: 'prompt', message: 'hello' });

    // 400 from the spawn attempt, not the locator's 404: the command reached the
    // recorded harness instead of looking for a session file that never existed.
    expect(response.status).toBe(400);
    const body = await payload(response);
    const message = typeof body.error === 'string' ? body.error : '';
    expect(message).not.toContain('Session not found');
    expect(message).toContain(MISSING);
  });
});
