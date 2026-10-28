/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The BTW store is the durable half of a side question: the panel re-reads it
 * on every reload, so a row it decodes wrongly is shown wrongly forever, and a
 * row it never writes is a lost answer. These tests drive the real module
 * against a throwaway SQLite file (never Kabmo's own database) and pin
 * the parts a caller depends on:
 *
 *  - turn indices are dense and monotonic per topic, because the panel indexes
 *    `turn.messages` by `turn.index`;
 *  - a turn is born `running` and only `settleRunningBtwTurns` may move the
 *    still-running ones — it must not rewrite an already-finished turn;
 *  - the status vocabulary is exactly omp's five words: a legacy `failed` (or
 *    any corrupted value) decodes as `interrupted` rather than throwing, and
 *    the bootstrap's data migration rewrites it to `error`;
 *  - a conversation column that is missing, NULL, or corrupt decodes as `[]`,
 *    so an old row renders as an empty conversation instead of a crash.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '@/server/lib/db/client';
import { getDb } from '@/server/db.server';
import {
  appendBtwTurn,
  createBtwTopic,
  deleteBtwTopic,
  getBtwTopic,
  isBtwTurnStatus,
  listBtwTopics,
  readBtwTopicLeaf,
  setBtwTopicLeaf,
  setBtwTopicModel,
  setBtwTopicPromoted,
  settleRunningBtwTurns,
  updateBtwTurn,
} from '@/server/lib/btw/store.server';
import type { ChatMessageData } from '@/shared/types';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  dirs.push(dir);
  return dir;
}

/** Point the db singleton at a fresh temp file, so no store call can reach the
 *  real Kabmo database. */
function useTempDb(): void {
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
}

function message(text: string): ChatMessageData {
  return { id: `m-${text}`, role: 'assistant', content: text, timestamp: 1 } as unknown as ChatMessageData;
}

afterEach(() => {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('topic CRUD', () => {
  test('createBtwTopic persists the model and thinking selector it was asked for', async () => {
    useTempDb();
    const topic = await createBtwTopic({
      sessionId: 's1',
      title: 'What is the codeword?',
      model: { provider: 'kenari', id: 'deepseek-v4-flash', name: 'Flash' },
      thinkingLevel: 'auto',
    });

    expect(topic.sessionId).toBe('s1');
    expect(topic.title).toBe('What is the codeword?');
    expect(topic.model).toEqual({ provider: 'kenari', id: 'deepseek-v4-flash', name: 'Flash' });
    expect(topic.thinkingLevel).toBe('auto');
    expect(topic.promotedSessionId).toBeUndefined();
    expect(topic.turns).toEqual([]);
    // Round-trips through SQLite unchanged.
    expect(await getBtwTopic(topic.id)).toEqual(topic);
  });

  test('a topic without a model reads back without one', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 'plain' });
    expect(topic.model).toBeUndefined();
    expect(topic.thinkingLevel).toBeUndefined();
    const read = await getBtwTopic(topic.id);
    expect(read?.model).toBeUndefined();
    expect(read?.thinkingLevel).toBeUndefined();
  });

  test('getBtwTopic is undefined for an unknown id', async () => {
    useTempDb();
    expect(await getBtwTopic('nope')).toBeUndefined();
  });

  test('listBtwTopics orders oldest first, groups turns, and is scoped to one session', async () => {
    useTempDb();
    const a = await createBtwTopic({ sessionId: 's1', title: 'a' });
    const b = await createBtwTopic({ sessionId: 's1', title: 'b' });
    const other = await createBtwTopic({ sessionId: 's2', title: 'other' });
    // Both may share a millisecond, so force the ordering the query promises.
    const db = await getDb();
    await db.run('UPDATE btw_topics SET created_at = ? WHERE id = ?', [1000, a.id]);
    await db.run('UPDATE btw_topics SET created_at = ? WHERE id = ?', [2000, b.id]);
    await appendBtwTurn(b.id, 'second question');
    await appendBtwTurn(b.id, 'third question');

    const topics = await listBtwTopics('s1');
    expect(topics.map((topic) => topic.id)).toEqual([a.id, b.id]);
    expect(topics[0].turns).toEqual([]);
    expect(topics[1].turns.map((turn) => turn.question)).toEqual(['second question', 'third question']);

    expect((await listBtwTopics('s2')).map((topic) => topic.id)).toEqual([other.id]);
    expect(await listBtwTopics('nobody')).toEqual([]);
  });

  test('setBtwTopicLeaf / readBtwTopicLeaf round-trip, defaulting to null', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    expect(await readBtwTopicLeaf(topic.id)).toBeNull();
    await setBtwTopicLeaf(topic.id, 'leaf-7');
    expect(await readBtwTopicLeaf(topic.id)).toBe('leaf-7');
    expect(await readBtwTopicLeaf('unknown')).toBeNull();
  });

  test('setBtwTopicModel replaces the stored model', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't', model: { provider: 'a', id: 'one' } });
    await setBtwTopicModel(topic.id, { provider: 'b', id: 'two', name: 'Two' });
    expect((await getBtwTopic(topic.id))?.model).toEqual({ provider: 'b', id: 'two', name: 'Two' });
  });

  test('setBtwTopicPromoted marks the topic as already branched', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await setBtwTopicPromoted(topic.id, 'session-9');
    expect((await getBtwTopic(topic.id))?.promotedSessionId).toBe('session-9');
  });

  test('deleteBtwTopic removes the topic and its turns, and reports whether it existed', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    expect(await deleteBtwTopic(topic.id)).toBe(true);
    expect(await getBtwTopic(topic.id)).toBeUndefined();
    expect(await (await getDb()).all('SELECT * FROM btw_turns WHERE topic_id = ?', [topic.id])).toEqual([]);
    expect(await deleteBtwTopic(topic.id)).toBe(false);
  });
});

describe('turn writes', () => {
  test('appendBtwTurn hands out dense indices and starts each turn running', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    expect(await appendBtwTurn(topic.id, 'q0')).toBe(0);
    expect(await appendBtwTurn(topic.id, 'q1')).toBe(1);

    const turns = (await getBtwTopic(topic.id))!.turns;
    expect(turns.map((turn) => ({ index: turn.index, question: turn.question, status: turn.status, answer: turn.answer }))).toEqual([
      { index: 0, question: 'q0', status: 'running', answer: '' },
      { index: 1, question: 'q1', status: 'running', answer: '' },
    ]);
  });

  test('updateBtwTurn patches only the fields present', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    const messages = [message('hi there')];
    await updateBtwTurn(topic.id, 0, { answer: 'hi there', status: 'complete', messages });

    let turn = (await getBtwTopic(topic.id))!.turns[0];
    expect(turn.answer).toBe('hi there');
    expect(turn.status).toBe('complete');
    expect(turn.messages).toEqual(messages);

    // Status-only patch must not clobber the answer or the conversation.
    await updateBtwTurn(topic.id, 0, { status: 'cancelled' });
    turn = (await getBtwTopic(topic.id))!.turns[0];
    expect(turn.status).toBe('cancelled');
    expect(turn.answer).toBe('hi there');
    expect(turn.messages).toEqual(messages);
  });

  test('updateBtwTurn ignores an unknown turn index', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    await updateBtwTurn(topic.id, 9, { answer: 'nope', status: 'error' });
    const turns = (await getBtwTopic(topic.id))!.turns;
    expect(turns).toHaveLength(1);
    expect(turns[0].answer).toBe('');
    expect(turns[0].status).toBe('running');
  });

  test('settleRunningBtwTurns moves only the still-running turns', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q0');
    await appendBtwTurn(topic.id, 'q1');
    await updateBtwTurn(topic.id, 1, { status: 'complete' });

    await settleRunningBtwTurns(topic.id, 'interrupted');
    expect((await getBtwTopic(topic.id))!.turns.map((turn) => turn.status)).toEqual(['interrupted', 'complete']);

    // Nothing is running any more, so a second settle is a no-op.
    await settleRunningBtwTurns(topic.id, 'cancelled');
    expect((await getBtwTopic(topic.id))!.turns.map((turn) => turn.status)).toEqual(['interrupted', 'complete']);
  });
});

describe('status vocabulary and legacy row decoding', () => {
  test('isBtwTurnStatus accepts exactly omp\'s five words', () => {
    for (const status of ['running', 'complete', 'cancelled', 'error', 'interrupted']) {
      expect(isBtwTurnStatus(status)).toBe(true);
    }
    // The pre-rename word is not a status any more.
    expect(isBtwTurnStatus('failed')).toBe(false);
    expect(isBtwTurnStatus('bogus')).toBe(false);
    expect(isBtwTurnStatus(undefined)).toBe(false);
    expect(isBtwTurnStatus(1)).toBe(false);
  });

  test('a stored value outside the vocabulary decodes as interrupted', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    // Written directly, after the bootstrap's one-time `failed` -> `error`
    // rewrite has already run.
    await (await getDb()).run("UPDATE btw_turns SET status = 'failed' WHERE topic_id = ?", [topic.id]);
    expect((await getBtwTopic(topic.id))!.turns[0].status).toBe('interrupted');
  });

  test('a missing, corrupt or non-array conversation decodes as empty', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    const db = await getDb();
    // `''` is what a pre-migration row's missing value decodes to in practice;
    // NULL is impossible now that the column is NOT NULL.
    for (const stored of ['', 'not json', '{"not":"an array"}']) {
      await db.run('UPDATE btw_turns SET messages = ? WHERE topic_id = ?', [stored, topic.id]);
      expect((await getBtwTopic(topic.id))!.turns[0].messages).toEqual([]);
    }
  });
});

describe('bootstrap on a pre-existing database', () => {
  test('adds the post-hoc columns and migrates a legacy failed turn', async () => {
    const dbPath = join(tempDir(), 'legacy.sqlite');
    const legacy = createDb(dbPath);
    await legacy.exec(`
      CREATE TABLE btw_topics (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        provider TEXT, model_id TEXT, model_name TEXT, leaf_id TEXT, promoted_session_id TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE btw_turns (
        topic_id TEXT NOT NULL, turn_index INTEGER NOT NULL, question TEXT NOT NULL DEFAULT '',
        answer TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        PRIMARY KEY (topic_id, turn_index)
      );
      INSERT INTO btw_topics (id, session_id, title, created_at, updated_at) VALUES ('t1', 's1', 'legacy', 1, 1);
      INSERT INTO btw_turns (topic_id, turn_index, question, status, created_at, updated_at)
        VALUES ('t1', 0, 'q', 'failed', 1, 1);
    `);
    legacy.raw.close();

    Bun.env.KABMO_DB_PATH = dbPath;
    Bun.env.SYNC_WORKSPACE = 'false';
    delete Bun.env.MOCK;
    globalThis.__kabmoDb = undefined;

    // The first read bootstraps the schema over the legacy file.
    const topic = await getBtwTopic('t1');
    expect(topic?.turns[0].status).toBe('error');
    expect(topic?.turns[0].messages).toEqual([]);

    const columns = (await (await getDb()).all('PRAGMA table_info(btw_topics)')) as { name: string }[];
    const names = columns.map((column) => column.name);
    expect(names).toContain('thinking_level');
    expect(names).toContain('approval_mode');
    expect((await getBtwTopic('t1'))?.thinkingLevel).toBeUndefined();
  });
});
