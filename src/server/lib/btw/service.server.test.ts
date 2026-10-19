/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The BTW service is the rule layer over the store: it is where a second side
 * question is refused while one is in flight, where a promotion is refused when
 * it cannot be honest (no answer yet, a running turn, follow-ups), and where a
 * topic's session ownership is enforced.
 *
 * Everything here is driven against a throwaway database with no side child and
 * no parent session file: each case stops at a guard that runs BEFORE the
 * module resolves a parent transcript or spawns anything, so the tests stay
 * offline and still pin the exact refusal the user sees. `getBtwState` is
 * exercised end to end because it is the read the panel makes on every load and
 * it is also the repair point for turns whose runtime died.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendBtwTurn, createBtwTopic, getBtwTopic, setBtwTopicPromoted, updateBtwTurn } from '@/server/lib/btw/store.server';
import { ensureBtwRuntime } from '@/server/lib/btw/registry.server';
import { BtwError } from '@/server/lib/btw/runtime.server';
import { abortBtw, askBtw, assertBtwIdle, getBtwState, promoteBtw, removeBtw } from '@/server/lib/btw/service.server';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-test-'));
  dirs.push(dir);
  return dir;
}

function useTempDb(): void {
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
}

afterEach(() => {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  globalThis.__ompBtwRegistry = undefined;
  delete Bun.env.KABMO_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  delete Bun.env.MOCK;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('getBtwState', () => {
  test('repairs a running turn whose runtime is gone', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');

    const state = await getBtwState('s1');
    expect(state.topics.map((entry) => entry.id)).toEqual([topic.id]);
    expect(state.topics[0].turns[0].status).toBe('interrupted');
    expect(state.runningTopicId).toBeNull();
  });

  test('keeps the turn running while its runtime is live', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    ensureBtwRuntime({ topicId: topic.id, sessionId: 's1', parentSessionFile: '/nonexistent', cwd: '/tmp' }).turnIndex = 0;

    const state = await getBtwState('s1');
    expect(state.topics[0].turns[0].status).toBe('running');
    expect(state.runningTopicId).toBe(topic.id);
  });
});

describe('one question in flight', () => {
  test('a second question is refused while one is running', async () => {
    useTempDb();
    ensureBtwRuntime({ topicId: 't1', sessionId: 's1', parentSessionFile: '/nonexistent', cwd: '/tmp' }).turnIndex = 0;

    const error = await askBtw('s1', { question: 'a second question' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BtwError);
    expect((error as BtwError).code).toBe('btw_busy');
  });

  test('assertBtwIdle blocks a session move while a question is running', async () => {
    useTempDb();
    await assertBtwIdle('s1', 'switch sessions');

    ensureBtwRuntime({ topicId: 't1', sessionId: 's1', parentSessionFile: '/nonexistent', cwd: '/tmp' }).turnIndex = 0;
    const error = await assertBtwIdle('s1', 'switch sessions').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BtwError);
    expect((error as BtwError).code).toBe('btw_busy');
    // The refusal names the operation it blocked, so the route can surface it.
    expect((error as BtwError).message).toContain('switch sessions');
  });

  test('an empty question is refused before any parent session is touched', async () => {
    useTempDb();
    const error = await askBtw('s1', { question: '   ' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BtwError);
    expect((error as BtwError).code).toBe('btw_empty');
  });

  test('a side question is unavailable in demo mode', async () => {
    useTempDb();
    Bun.env.MOCK = 'true';
    try {
      const error = await askBtw('s1', { question: 'hello' }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BtwError);
      expect((error as BtwError).code).toBe('btw_unavailable');
    } finally {
      delete Bun.env.MOCK;
    }
  });
});

describe('promotion guards', () => {
  test('an unknown or foreign topic is refused', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    const unknown = await promoteBtw('s1', 'nope').catch((caught: unknown) => caught);
    expect((unknown as BtwError).code).toBe('btw_topic_not_found');
    const foreign = await promoteBtw('s2', topic.id).catch((caught: unknown) => caught);
    expect((foreign as BtwError).code).toBe('btw_topic_not_found');
  });

  test('a topic with no answer yet is refused', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    const error = await promoteBtw('s1', topic.id).catch((caught: unknown) => caught);
    expect((error as BtwError).code).toBe('btw_empty');
  });

  test('a topic with a running turn is refused', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    const error = await promoteBtw('s1', topic.id).catch((caught: unknown) => caught);
    expect((error as BtwError).code).toBe('btw_busy');
  });

  test('a topic with follow-ups is refused, because a branch carries one answer', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q0');
    await appendBtwTurn(topic.id, 'q1');
    await updateBtwTurn(topic.id, 0, { status: 'complete' });
    await updateBtwTurn(topic.id, 1, { status: 'complete' });

    const error = await promoteBtw('s1', topic.id).catch((caught: unknown) => caught);
    expect((error as BtwError).code).toBe('btw_multi_turn');
  });

  test('promoting twice re-opens the branch already written', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await setBtwTopicPromoted(topic.id, 'session-existing');
    // No parent session file exists; the early return must not look for one.
    expect(await promoteBtw('s1', topic.id)).toEqual({ sessionId: 'session-existing' });
  });
});

describe('abort and remove', () => {
  test('abort with no live runtime still returns the settled state', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');

    const state = await abortBtw('s1', topic.id);
    expect(state.topics[0].turns[0].status).toBe('interrupted');
  });

  test('abort refuses a foreign topic', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    const error = await abortBtw('s2', topic.id).catch((caught: unknown) => caught);
    expect((error as BtwError).code).toBe('btw_topic_not_found');
  });

  test('remove deletes the topic and its turns', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');

    const state = await removeBtw('s1', topic.id);
    expect(state.topics).toEqual([]);
    expect(await getBtwTopic(topic.id)).toBeUndefined();
  });

  test('remove refuses an unknown topic', async () => {
    useTempDb();
    const error = await removeBtw('s1', 'nope').catch((caught: unknown) => caught);
    expect((error as BtwError).code).toBe('btw_topic_not_found');
  });
});
