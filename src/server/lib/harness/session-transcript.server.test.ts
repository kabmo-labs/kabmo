/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transcript guard behind the sidebar and the import pass.
 *
 * The bug this pins: an agent reports every session it CREATED, not the ones
 * that were used. Measured on this machine, 114 of opencode's 131 sessions hold
 * zero messages, and the sidebar drew them as `New session - <timestamp>` rows
 * that open an empty chat. The guard answers "provably empty" only for a store
 * Kabmo can read; an unreadable store is not evidence, and the row is kept.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { sessionsWithoutTranscript } from '@kabmo-labs/kabmo-harness/session/session-transcript.server';

const saved = {
  xdg: Bun.env.XDG_DATA_HOME,
  dsh: Bun.env.DSH_HOME,
  claude: Bun.env.CLAUDE_CONFIG_DIR,
  codex: Bun.env.CODEX_HOME,
  zcode: Bun.env.ZCODE_HOME,
  antigravity: Bun.env.ANTIGRAVITY_HOME,
};

let root = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(join(tmpdir(), 'omc-transcript-guard-'));
});

afterAll(() => {
  for (const [key, value] of [
    ['XDG_DATA_HOME', saved.xdg],
    ['DSH_HOME', saved.dsh],
    ['CLAUDE_CONFIG_DIR', saved.claude],
    ['CODEX_HOME', saved.codex],
    ['ZCODE_HOME', saved.zcode],
    ['ANTIGRAVITY_HOME', saved.antigravity],
  ] as const) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  removeDir(root);
});

beforeEach(async () => {
  await isolateDb();
  for (const dir of ['xdg', 'dsh', 'claude', 'codex', 'zcode', 'antigravity']) {
    await fs.promises.rm(join(root, dir), { recursive: true, force: true });
  }
  Bun.env.XDG_DATA_HOME = join(root, 'xdg');
  Bun.env.DSH_HOME = join(root, 'dsh');
  Bun.env.CLAUDE_CONFIG_DIR = join(root, 'claude');
  Bun.env.CODEX_HOME = join(root, 'codex');
  Bun.env.ZCODE_HOME = join(root, 'zcode');
  Bun.env.ANTIGRAVITY_HOME = join(root, 'antigravity');
});

afterEach(async () => {
  await releaseDb();
});

/** One opencode store with a v1 `message` table and the given session ids. */
async function writeOpencodeStore(ids: string[]): Promise<void> {
  const dir = join(root, 'xdg', 'opencode');
  await fs.promises.mkdir(dir, { recursive: true });
  const db = new Database(join(dir, 'opencode.db'), { create: true });
  db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL)');
  for (const id of ids) db.run('INSERT INTO message (id, session_id) VALUES (?, ?)', [`${id}-m`, id]);
  db.close();
}

describe('sessionsWithoutTranscript', () => {
  test('opencode: a session with no message row is empty, one with a row is not', async () => {
    await writeOpencodeStore(['ses_used']);
    const absent = await sessionsWithoutTranscript([
      { harness: 'opencode', sessionId: 'ses_used' },
      { harness: 'opencode', sessionId: 'ses_empty' },
    ]);
    expect([...absent]).toEqual(['ses_empty']);
  });

  test('opencode: a missing store yields no verdict', async () => {
    const absent = await sessionsWithoutTranscript([{ harness: 'opencode', sessionId: 'ses_empty' }]);
    expect(absent.size).toBe(0);
  });

  test('dsh: a header-only session is empty even though the file is not', async () => {
    const project = join(root, 'dsh', 'sessions', '--project--');
    const write = async (id: string, lines: string[]) => {
      await fs.promises.mkdir(join(project, id), { recursive: true });
      const body = new TextEncoder().encode(`${lines.join('\n')}\n`);
      await Bun.write(join(project, id, 'session.v4.jsonl.zstd'), Bun.zstdCompressSync(body));
    };
    await write('used', [
      '{"type":"session","version":4,"id":"used"}',
      '{"type":"turn/start","turn":0}',
    ]);
    // The shape dsh writes before the first prompt: a header and its setup
    // events, no turn and no message.
    await write('empty', [
      '{"type":"session","version":4,"id":"empty"}',
      '{"type":"permission/preset","seq":0}',
      '{"type":"sandbox/mode","seq":1}',
      '{"type":"approval/policy","seq":2}',
    ]);
    const absent = await sessionsWithoutTranscript([
      { harness: 'dsh', sessionId: 'used' },
      { harness: 'dsh', sessionId: 'empty' },
    ]);
    expect([...absent]).toEqual(['empty']);
  });

  test('claude: the project jsonl is the transcript', async () => {
    const project = join(root, 'claude', 'projects', '-tmp-project');
    await fs.promises.mkdir(project, { recursive: true });
    await Bun.write(join(project, 'used.jsonl'), '{"type":"user"}\n');
    const absent = await sessionsWithoutTranscript([
      { harness: 'claude', sessionId: 'used' },
      { harness: 'claude', sessionId: 'empty' },
    ]);
    expect([...absent]).toEqual(['empty']);
  });

  test('codex: the rollout file is the transcript', async () => {
    const dir = join(root, 'codex', 'sessions', '2026', '01', '01');
    await fs.promises.mkdir(dir, { recursive: true });
    await Bun.write(join(dir, 'rollout-2026-01-01T00-00-00-used.jsonl'), '{}\n');
    const absent = await sessionsWithoutTranscript([
      { harness: 'codex', sessionId: 'used' },
      { harness: 'codex', sessionId: 'empty' },
    ]);
    expect([...absent]).toEqual(['empty']);
  });

  test('zcode: a session with no message row is empty', async () => {
    const dir = join(root, 'zcode', 'cli', 'db');
    await fs.promises.mkdir(dir, { recursive: true });
    const db = new Database(join(dir, 'db.sqlite'), { create: true });
    db.exec('CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL)');
    db.run('INSERT INTO message (id, session_id) VALUES (?, ?)', ['m1', 'sess_used']);
    db.close();
    const absent = await sessionsWithoutTranscript([
      { harness: 'zcode', sessionId: 'sess_used' },
      { harness: 'zcode', sessionId: 'sess_empty' },
    ]);
    expect([...absent]).toEqual(['sess_empty']);
  });

  test('antigravity: a conversation with no steps is empty', async () => {
    const dir = join(root, 'antigravity', 'antigravity-cli', 'conversations');
    await fs.promises.mkdir(dir, { recursive: true });
    const used = new Database(join(dir, 'used.db'), { create: true });
    used.exec('CREATE TABLE steps (id TEXT PRIMARY KEY)');
    used.run('INSERT INTO steps (id) VALUES (?)', ['s1']);
    used.close();
    const empty = new Database(join(dir, 'empty.db'), { create: true });
    empty.exec('CREATE TABLE steps (id TEXT PRIMARY KEY)');
    empty.close();
    const absent = await sessionsWithoutTranscript([
      { harness: 'antigravity', sessionId: 'used' },
      { harness: 'antigravity', sessionId: 'empty' },
    ]);
    expect([...absent]).toEqual(['empty']);
  });

  test('a harness with no readable store is never called empty', async () => {
    const absent = await sessionsWithoutTranscript([
      { harness: 'pi', sessionId: 'ses_unknown' },
      { harness: 'qwen', sessionId: 'sess_unknown' },
    ]);
    expect(absent.size).toBe(0);
  });
});
