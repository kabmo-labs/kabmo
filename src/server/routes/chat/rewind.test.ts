/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The in-place rewind endpoint, driven against a real session file.
 *
 * Two rules are pinned here, both of which the ACP transport made visible:
 *
 *  - the live child is torn down BEFORE the file is touched. `omp-acp` writes
 *    the same JSONL and flushes it on shutdown, so a rewind that rewrote the
 *    file first raced the child and could be overwritten by its final flush;
 *  - a harness whose agent keeps its own transcript is refused BEFORE its child
 *    is destroyed. `claude` has no omp file to truncate, so the old shape would
 *    have killed a working chat and then answered 404.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { registerAcpSession } from '@/server/lib/harness/register.server';
import { claimHarness } from '@/server/lib/harness/registry';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { action } from '@/server/routes/chat/rewind';
import type { HarnessSession } from '@/server/lib/harness/session';
import type { HarnessId } from '@/shared/lib/harness/catalog';

const SESSION_ID = '01a1b49f-0000-7000-8000-000000000001';

const FIXTURE = [
  JSON.stringify({ type: 'session', id: SESSION_ID, cwd: '/tmp/project' }),
  JSON.stringify({ type: 'message', id: 'u1', timestamp: 1_000, message: { role: 'user', content: 'first ask' } }),
  JSON.stringify({ type: 'message', id: 'a1', timestamp: 2_000, message: { role: 'assistant', content: 'answer' } }),
  '',
].join('\n');

let root = '';
let filePath = '';
let previousAgentDir: string | undefined;

/** Register a fake ACP session the route's `getLiveSession` lookup will find. */
function registerLive(id: string, harness: HarnessId, onDestroy?: () => void): () => void {
  let release: (() => void) | null = null;
  const session = {
    sessionId: id,
    harness,
    sessionFile: '',
    cwd: '/tmp/project',
    isStreaming: false,
    isPromptRunning: false,
    runModel: null,
    isAlive: () => true,
    isRunning: () => false,
    isBusy: () => false,
    send: async () => ({}),
    getPendingUiDialogs: () => [],
    resolvePendingUiDialog: () => {},
    onEvent: () => () => {},
    emit: () => {},
    destroy: () => {},
    destroyAndWait: async () => {
      onDestroy?.();
      release?.();
    },
    onDestroy: (callback: () => void) => {
      release = callback;
    },
  } as unknown as HarnessSession;
  registerAcpSession(session, id);
  claimHarness(session, harness);
  return () => release?.();
}

function rewind(entryId = 'u1'): Promise<Response> {
  return action({
    params: { sessionId: SESSION_ID },
    request: new Request(`http://localhost/api/chat/${SESSION_ID}/rewind`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId }),
    }),
  } as never) as Promise<Response>;
}

beforeEach(async () => {
  previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  root = mkdtempSync(join(tmpdir(), 'kabmo-rewind-'));
  Bun.env.PI_CODING_AGENT_DIR = root;
  const project = join(root, 'sessions', 'project');
  mkdirSync(project, { recursive: true });
  filePath = join(project, `${SESSION_ID}.jsonl`);
  writeFileSync(filePath, FIXTURE);
  clearSessionFileCaches();
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
  clearSessionFileCaches();
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (root) removeDir(root);
  root = '';
});

describe('POST /api/chat/:id/rewind', () => {
  test('an omp-acp chat is torn down BEFORE its shared JSONL is rewritten', async () => {
    const atTeardown: string[] = [];
    const release = registerLive(SESSION_ID, 'omp-acp', () => atTeardown.push(readFileSync(filePath, 'utf8')));
    try {
      const response = await rewind();
      expect(response.status).toBe(200);
      // The child still had the abandoned turn when it was destroyed — proof the
      // teardown ran first, not after the rewrite.
      expect(atTeardown).toHaveLength(1);
      expect(atTeardown[0]).toContain('"id":"a1"');

      const next = readFileSync(filePath, 'utf8');
      expect(next).not.toContain('"id":"u1"');
      expect(next).not.toContain('"id":"a1"');
      expect(next).toContain('"type":"session"');
    } finally {
      release();
    }
  });

  test('another ACP agent is refused without destroying its live child', async () => {
    let destroyed = 0;
    const release = registerLive(SESSION_ID, 'claude', () => { destroyed += 1; });
    try {
      const response = await rewind();
      expect(response.status).toBe(400);
      const body = (await response.json()) as { code?: string; error?: string };
      expect(body.code).toBe('harness_not_rewindable');
      expect(body.error).toContain('claude');
      expect(destroyed).toBe(0);
      // Its file — when it has one Kabmo can find — is untouched.
      expect(readFileSync(filePath, 'utf8')).toContain('"id":"u1"');
    } finally {
      release();
    }
  });
});
