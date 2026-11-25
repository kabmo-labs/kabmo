/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A stored row written BEFORE the `render` contract still opens its panel.
 *
 * The parser copies a tool block's `render` verbatim and never derives one
 * (`parse-message-blocks.ts`), so a chat saved by an older build had no family
 * on any card and drew the JSON fallback forever — while the same frames
 * classify correctly today. The loader is the read path that had no
 * normalization pass; the JSONL, replay and recorder reads already had one.
 *
 * The row below is the shape a pre-contract build wrote: `name` in the
 * adapter's own vocabulary and no `render`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { getDb } from '@/server/db.server';
import { loader } from '@/server/routes/chat/session';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const previousXdg = Bun.env.XDG_DATA_HOME;
let agentRoot = '';

beforeEach(async () => {
  agentRoot = await fs.promises.mkdtemp(join(tmpdir(), 'kabmo-legacy-tools-'));
  await fs.promises.mkdir(join(agentRoot, 'sessions'), { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agentRoot;
  // An existing XDG root would redirect the sessions dir away from the temp one,
  // and a discovered file would take the JSONL branch instead of the DB row.
  delete Bun.env.XDG_DATA_HOME;
  clearSessionFileCaches();
  delete Bun.env.MOCK;
  await isolateDb();
});

afterEach(async () => {
  clearSessionFileCaches();
  await fs.promises.rm(agentRoot, { recursive: true, force: true });
  await releaseDb();
});

afterAll(() => {
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  if (previousXdg === undefined) delete Bun.env.XDG_DATA_HOME;
  else Bun.env.XDG_DATA_HOME = previousXdg;
});

/** Store one row under a session id, exactly as an older build wrote it. */
async function storeLegacyRow(sessionId: string, messages: unknown[]): Promise<void> {
  const db = await getDb();
  await db.run(
    'INSERT INTO chat_sessions (session_id, title, messages, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
    [sessionId, `Session ${sessionId}`, JSON.stringify(messages)],
  );
}

interface LoadedTool {
  id: string;
  name?: string;
  render?: { key: string; normalized: boolean };
}

async function loadTools(sessionId: string): Promise<LoadedTool[]> {
  const response = (await loader({
    request: new Request(`http://localhost/api/chat/${sessionId}`),
    params: { sessionId },
  } as never)) as Response;
  const body = (await response.json()) as {
    session: { messages: Array<{ toolCalls?: LoadedTool[] }> };
  };
  return body.session.messages.flatMap((row) => row.toolCalls ?? []);
}

describe('chat session loader on a pre-contract stored row', () => {
  test('a tool call with no render gets its renderer family on read', async () => {
    await storeLegacyRow('legacy-tools', [
      { id: 'u1', role: 'user', content: 'list the files' },
      {
        id: 'a1',
        role: 'ai',
        content: 'done',
        toolCalls: [
          // opencode's own word for the shell, no `render`.
          { id: 'c1', type: 'bash', title: 'ls', name: 'shell', output: 'a.ts' },
          // The gemini-family spelling: a name no panel lookup knew before the
          // alias table carried it.
          { id: 'c2', type: 'read_file', title: 'a.ts', name: 'view_file' },
        ],
      },
    ]);

    const tools = await loadTools('legacy-tools');
    expect(tools.map((tool) => tool.render?.key)).toEqual(['bash', 'read']);
    expect(tools.every((tool) => tool.render?.normalized === true)).toBe(true);
  });

  test('a row that already carries a family is returned unchanged', async () => {
    // Idempotence is what makes this safe on every read of the same chat: a row
    // normalized by a previous load must not be reclassified by a later table.
    await storeLegacyRow('already-normalized', [
      { id: 'u1', role: 'user', content: 'go' },
      {
        id: 'a1',
        role: 'ai',
        content: 'done',
        toolCalls: [
          {
            id: 'c1',
            type: 'bash',
            title: 'ls',
            name: 'shell',
            // A deliberate family: the transport said `eval`, and the stored
            // decision must survive even though `shell` folds to `bash`.
            render: { key: 'eval', normalized: true },
          },
        ],
      },
    ]);

    const tools = await loadTools('already-normalized');
    expect(tools[0]?.render).toEqual({ key: 'eval', normalized: true });
  });
});
