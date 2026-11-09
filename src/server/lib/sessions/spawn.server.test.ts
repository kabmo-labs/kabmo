/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Spawning a child session: the relation is written before the first prompt,
 * the depth cap is checked before anything is spawned, and a failure after the
 * spawn tears the child down instead of leaving a session nobody owns.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { createSessionRelation, getSessionRelation } from '@/server/lib/sessions/relations.server';
import {
  SessionSpawnError,
  spawnChildSession,
  type SpawnSessionDeps,
  type SpawnedSession,
} from '@/server/lib/sessions/spawn.server';

let root = '';

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  root = mkdtempSync(join(tmpdir(), 'kabmo-spawn-'));
  const db = await getDb();
  await db.run(
    'INSERT INTO workspace_folders (id, name, project_path) VALUES (?, ?, ?)',
    [1, 'one', root],
  );
});

afterEach(async () => {
  await releaseDb();
});

function fakeSession(sessionId: string, options: { failPrompt?: boolean } = {}): SpawnedSession & {
  sent: Record<string, unknown>[];
  destroyed: boolean;
} {
  const sent: Record<string, unknown>[] = [];
  const state = {
    sessionId,
    sent,
    destroyed: false,
    async send(command: Record<string, unknown>) {
      if (options.failPrompt) throw new Error('provider refused');
      sent.push(command);
      return { agentInvoked: true };
    },
    async destroyAndWait() {
      state.destroyed = true;
    },
  };
  return state;
}

function depsFor(session: SpawnedSession, onStart?: (cwd: string) => void): SpawnSessionDeps {
  return {
    async startRpc(cwd) {
      onStart?.(cwd);
      return { session, realSessionId: session.sessionId };
    },
    async startAcp() {
      throw new Error('not used');
    },
  };
}

describe('spawnChildSession', () => {
  test('writes the relation before sending, and reports the depth', async () => {
    await saveHarnessSession({
      sessionId: 'parent',
      harness: 'omp-rpc',
      agentSessionId: '',
      cwd: root,
    });
    const child = fakeSession('child');
    const result = await spawnChildSession(
      { parentSessionId: 'parent', prompt: 'review this' },
      depsFor(child),
    );

    expect(result).toEqual({
      sessionId: 'child',
      harness: 'omp-rpc',
      parentSessionId: 'parent',
      depth: 1,
    });
    expect(child.sent).toHaveLength(1);
    expect(child.sent[0]).toMatchObject({ type: 'prompt' });
    expect(String(child.sent[0].message)).toStartWith('[kabmo dispatched worker]');
    expect(String(child.sent[0].message)).toContain('your coordinator is session parent');
    expect(String(child.sent[0].message)).toEndWith('TASK\nreview this');
    expect(await getSessionRelation('child')).toMatchObject({
      parentSessionId: 'parent',
      lifecycleOwnerSessionId: 'parent',
      depth: 1,
    });
  });

  test('refuses a fifth level before spawning anything', async () => {
    await createSessionRelation({ sessionId: 'l1' });
    await createSessionRelation({ sessionId: 'l2', parentSessionId: 'l1' });
    await createSessionRelation({ sessionId: 'l3', parentSessionId: 'l2' });
    await createSessionRelation({ sessionId: 'l4', parentSessionId: 'l3' });
    await createSessionRelation({ sessionId: 'l5', parentSessionId: 'l4' });
    await saveHarnessSession({
      sessionId: 'l5',
      harness: 'omp-rpc',
      agentSessionId: '',
      cwd: root,
    });

    let started = false;
    await expect(
      spawnChildSession(
        { parentSessionId: 'l5', prompt: 'too deep' },
        depsFor(fakeSession('child'), () => {
          started = true;
        }),
      ),
    ).rejects.toMatchObject({ code: 'spawn_failed' });
    expect(started).toBe(false);
  });

  test('refuses a child outside the parent workspace folder', async () => {
    const other = mkdtempSync(join(tmpdir(), 'kabmo-other-'));
    const db = await getDb();
    await db.run('INSERT INTO workspace_folders (id, name, project_path) VALUES (?, ?, ?)', [
      2,
      'two',
      other,
    ]);
    await saveHarnessSession({
      sessionId: 'parent',
      harness: 'omp-rpc',
      agentSessionId: '',
      cwd: root,
    });

    await expect(
      spawnChildSession(
        { parentSessionId: 'parent', cwd: other, prompt: 'elsewhere' },
        depsFor(fakeSession('child')),
      ),
    ).rejects.toMatchObject({ code: 'parent_folder_mismatch' });
  });

  test('an ACP worker with no explicit model leaves the harness default alone', async () => {
    await saveHarnessSession({
      sessionId: 'parent',
      harness: 'claude',
      agentSessionId: 'agent-parent',
      cwd: root,
    });
    let captured: { provider: string; modelId: string } | null | undefined;
    const child = fakeSession('child');
    const deps: SpawnSessionDeps = {
      async startRpc() {
        throw new Error('not used');
      },
      async startAcp(request) {
        captured = request.model;
        return { session: child, realSessionId: child.sessionId };
      },
    };

    await spawnChildSession({ parentSessionId: 'parent', prompt: 'review this' }, deps);
    expect(captured).toBeNull();
  });

  test('a refused first prompt destroys the child and records nothing', async () => {
    await saveHarnessSession({
      sessionId: 'parent',
      harness: 'omp-rpc',
      agentSessionId: '',
      cwd: root,
    });
    const child = fakeSession('child', { failPrompt: true });

    await expect(
      spawnChildSession({ parentSessionId: 'parent', prompt: 'hello' }, depsFor(child)),
    ).rejects.toBeInstanceOf(SessionSpawnError);
    expect(child.destroyed).toBe(true);
    expect(await getSessionRelation('child')).toMatchObject({ parentSessionId: 'parent' });
  });
});
