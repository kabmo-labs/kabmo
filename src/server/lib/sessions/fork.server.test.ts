/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Forking: the file surgery, the anchor rules, and the capability refusal.
 *
 * A real omp child is replaced by a fake start function; everything that
 * matters here is the transcript Kabmo writes and the relation it records.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { readFile, readdir, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { ensureSessionRelationsSchema } from '@/server/lib/sessions/schema.server';
import { saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { getSessionRelation } from '@/server/lib/sessions/relations.server';
import { forkSession, type ForkSessionDeps, type ForkedSession } from '@/server/lib/sessions/fork.server';
import { buildTitleLine } from '@/server/lib/omp/session/transcript-copy';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

let sessionsRoot = '';
let projectDir = '';
let agentRoot = '';
let savedAgentDir: string | undefined;
const timestamp = '2026-11-09T10:00:00.000Z';

beforeEach(async () => {
  await isolateDb();
  await ensureSessionRelationsSchema(await getDb());
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  agentRoot = mkdtempSync(join(tmpdir(), 'kabmo-fork-agent-'));
  sessionsRoot = join(agentRoot, 'sessions');
  projectDir = join(sessionsRoot, 'project');
  await mkdir(projectDir, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentRoot;
  clearSessionFileCaches();
});

afterEach(async () => {
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  clearSessionFileCaches();
  await rm(agentRoot, { recursive: true, force: true });
  await releaseDb();
});

const sourceLines = [
  buildTitleLine('source chat', 'user', timestamp),
  JSON.stringify({ type: 'session', id: 'src', cwd: '/tmp/project', timestamp }),
  JSON.stringify({ type: 'message', id: 'u1', message: { role: 'user', content: [{ type: 'text', text: 'first' }] } }),
  JSON.stringify({ type: 'message', id: 'a1', message: { role: 'assistant', content: [{ type: 'text', text: 'answer one' }] } }),
  JSON.stringify({ type: 'message', id: 'u2', message: { role: 'user', content: [{ type: 'text', text: 'second' }] } }),
  JSON.stringify({ type: 'message', id: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'answer two' }] } }),
];

async function writeSource(): Promise<string> {
  const file = join(projectDir, `${timestamp.replace(/[:.]/g, '-')}_src.jsonl`);
  await Bun.write(file, `${sourceLines.join('\n')}\n`);
  clearSessionFileCaches();
  return file;
}

function fakeForked(sessionId: string): ForkedSession & { sent: unknown[] } {
  const state = {
    sessionId,
    sent: [] as unknown[],
    async send(command: Record<string, unknown>) {
      state.sent.push(command);
      return { agentInvoked: true };
    },
    async destroyAndWait() {},
  };
  return state;
}

function fakeDeps(
  sessionId: string,
  options: { forkSupported?: boolean } = {},
): ForkSessionDeps & { rpcCalls: unknown[]; acpCalls: unknown[] } {
  const rpcCalls: unknown[] = [];
  const acpCalls: unknown[] = [];
  return {
    rpcCalls,
    acpCalls,
    async startRpc(id, file, cwd) {
      rpcCalls.push({ id, file, cwd });
      return { session: fakeForked(id), realSessionId: id };
    },
    async startAcp(request) {
      acpCalls.push(request);
      return { session: fakeForked(sessionId), realSessionId: sessionId };
    },
    async probeForkSupported() {
      return options.forkSupported ?? false;
    },
  };
}

/** The fork's file: the one file in the directory that is not the source. */
async function forkFile(sourceFile: string): Promise<{ path: string; lines: string[] }> {
  const files = (await readdir(projectDir)).filter((name) => name.endsWith('.jsonl') && join(projectDir, name) !== sourceFile);
  expect(files).toHaveLength(1);
  const path = join(projectDir, files[0]!);
  const lines = (await readFile(path, 'utf8')).trimEnd().split('\n');
  return { path, lines };
}

describe('forkSession (omp)', () => {
  test('tip fork copies every turn under a new header', async () => {
    const sourceFile = await writeSource();
    const deps = fakeDeps('ignored');
    const result = await forkSession({ sourceSessionId: 'src' }, deps);

    expect(result.originKind).toBe('fork');
    expect(await getSessionRelation(result.sessionId)).toMatchObject({
      sourceSessionId: 'src',
      originKind: 'fork',
      parentSessionId: null,
    });
    const { path, lines } = await forkFile(sourceFile);
    expect(deps.rpcCalls).toHaveLength(1);
    expect((deps.rpcCalls[0] as { file: string }).file).toBe(path);
    const header = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(header).toMatchObject({ id: result.sessionId, parentSession: sourceFile });
    expect(lines.some((line) => line.includes('"text":"answer two"'))).toBe(true);
    // The source is untouched.
    expect(await readFile(sourceFile, 'utf8')).toBe(`${sourceLines.join('\n')}\n`);
  });

  test('an anchor on a user message branches before that turn', async () => {
    const sourceFile = await writeSource();
    await forkSession({ sourceSessionId: 'src', anchorEntryId: 'u2' }, fakeDeps('ignored'));
    const { lines } = await forkFile(sourceFile);
    expect(lines.some((line) => line.includes('"id":"u2"'))).toBe(false);
    expect(lines.some((line) => line.includes('"id":"a1"'))).toBe(true);
  });

  test('an anchor the transcript does not carry is refused, not treated as tip', async () => {
    await writeSource();
    await expect(
      forkSession({ sourceSessionId: 'src', anchorEntryId: 'overlay-only' }, fakeDeps('never')),
    ).rejects.toMatchObject({ code: 'anchor_not_found' });
  });

  test('an anchor on an assistant message keeps that turn and drops later ones', async () => {
    const sourceFile = await writeSource();
    await forkSession({ sourceSessionId: 'src', anchorEntryId: 'a1' }, fakeDeps('ignored'));
    const { lines } = await forkFile(sourceFile);
    expect(lines.some((line) => line.includes('"id":"a1"'))).toBe(true);
    expect(lines.some((line) => line.includes('"id":"u2"'))).toBe(false);
  });
});

describe('forkSession (ACP)', () => {
  test('a recorded ACP session forks through session/fork', async () => {
    await saveHarnessSession({
      sessionId: 'acp-source',
      harness: 'claude',
      agentSessionId: 'agent-1',
      cwd: '/tmp/project',
    });
    const deps = fakeDeps('acp-fork', { forkSupported: true });
    const result = await forkSession({ sourceSessionId: 'acp-source' }, deps);
    expect(result.sessionId).toBe('acp-fork');
    expect(deps.acpCalls).toEqual([
      expect.objectContaining({ harness: 'claude', forkAgentSessionId: 'agent-1' }),
    ]);
    expect(await getSessionRelation('acp-fork')).toMatchObject({
      sourceSessionId: 'acp-source',
      originKind: 'fork',
    });
  });

  test('a harness without fork support is refused before spawning', async () => {
    await saveHarnessSession({
      sessionId: 'acp-source',
      harness: 'claude',
      agentSessionId: 'agent-1',
      cwd: '/tmp/project',
    });
    const deps = fakeDeps('never', { forkSupported: false });
    await expect(forkSession({ sourceSessionId: 'acp-source' }, deps)).rejects.toMatchObject({
      code: 'fork_unsupported',
    });
    expect(deps.acpCalls).toHaveLength(0);
  });

  test('a checkpoint requirement is its own refusal, not a generic failure', async () => {
    await saveHarnessSession({
      sessionId: 'zcode-source',
      harness: 'zcode',
      agentSessionId: 'agent-z',
      cwd: '/tmp/project',
    });
    const deps = fakeDeps('never', { forkSupported: true });
    deps.startAcp = async () => {
      throw new Error('fork failed: No workspace checkpoint is available yet.');
    };
    await expect(forkSession({ sourceSessionId: 'zcode-source' }, deps)).rejects.toMatchObject({
      code: 'fork_requires_checkpoint',
    });
  });
});
