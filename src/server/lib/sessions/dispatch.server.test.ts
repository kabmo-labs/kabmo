/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The cold path's branch logic: file → RPC, recorded ACP → session/load,
 * nothing resolvable → null. The deps are fakes; a real spawn is the live
 * smoke's job, not a unit test's.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { getDb } from '@/server/db.server';
import { ensureSessionLive, type DispatchDeps } from '@/server/lib/sessions/dispatch.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import type { QueueDeliveryHost } from '@/server/lib/queue/delivery.server';

let agentRoot = '';
let savedAgentDir: string | undefined;

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  agentRoot = mkdtempSync(join(tmpdir(), 'kabmo-dispatch-'));
  Bun.env.PI_CODING_AGENT_DIR = agentRoot;
  clearSessionFileCaches();
});

afterEach(async () => {
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  clearSessionFileCaches();
  await releaseDb();
});

function host(sessionId: string): QueueDeliveryHost {
  return {
    sessionId,
    isAlive: () => true,
    isBusy: () => false,
    async send() {
      return null;
    },
  };
}

function deps(overrides: Partial<DispatchDeps>): DispatchDeps {
  return {
    async findFile() {
      return undefined;
    },
    async startOmp() {
      throw new Error('not used');
    },
    async startAcp() {
      throw new Error('not used');
    },
    ...overrides,
  };
}

describe('ensureSessionLive', () => {
  test('an id with no transcript, record or cwd answers null', async () => {
    expect(await ensureSessionLive('missing-session', deps({}))).toBeNull();
  });

  test('a recorded ACP session resumes through session/load', async () => {
    await saveHarnessSession({
      sessionId: 'acp-1',
      harness: 'claude',
      agentSessionId: 'agent-1',
      cwd: '/tmp/project',
    });
    const calls: unknown[] = [];
    const result = await ensureSessionLive(
      'acp-1',
      deps({
        async startAcp(sessionId, harness, cwd, agentSessionId) {
          calls.push({ sessionId, harness, cwd, agentSessionId });
          return host(sessionId);
        },
      }),
    );
    expect(result?.sessionId).toBe('acp-1');
    expect(calls).toEqual([
      { sessionId: 'acp-1', harness: 'claude', cwd: '/tmp/project', agentSessionId: 'agent-1' },
    ]);
  });

  test('a file-backed session resumes over RPC even when its record says ACP', async () => {
    await saveHarnessSession({
      sessionId: 'omp-acp-1',
      harness: 'omp-acp',
      agentSessionId: '',
      cwd: '/tmp/project',
    });
    const calls: unknown[] = [];
    const result = await ensureSessionLive(
      'omp-acp-1',
      deps({
        async findFile() {
          return '/tmp/sessions/project/session.jsonl';
        },
        async startOmp(sessionId, file, cwd) {
          calls.push({ sessionId, file, cwd });
          return host(sessionId);
        },
        async startAcp() {
          throw new Error('must not use session/load for an omp file');
        },
      }),
    );
    expect(result?.sessionId).toBe('omp-acp-1');
    expect(calls).toEqual([
      { sessionId: 'omp-acp-1', file: '/tmp/sessions/project/session.jsonl', cwd: '/tmp/project' },
    ]);
  });

  test('a failed resume answers null rather than throwing into the caller', async () => {
    await saveHarnessSession({
      sessionId: 'acp-2',
      harness: 'claude',
      agentSessionId: 'agent-2',
      cwd: '/tmp/project',
    });
    const result = await ensureSessionLive(
      'acp-2',
      deps({
        async startAcp() {
          throw new Error('agent refused');
        },
      }),
    );
    expect(result).toBeNull();
  });
});
