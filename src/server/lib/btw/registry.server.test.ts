/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The BTW registry owns two things the rest of the server treats as facts:
 * which topic currently has a question in flight, and the fan-out that carries
 * every frame to the session's subscribers.
 *
 * The repair in `btwStateFor` is the risky half. A turn row left `running` by a
 * server restart or a killed child can never finish, so the next read must
 * settle it as `interrupted` — otherwise every later question is refused behind
 * a turn that will never complete. The counter-case matters just as much: a
 * runtime that is mid-settle, or still running, must NOT be treated as gone, or
 * the repair overwrites a real answer. Both windows are pinned here.
 *
 * `globalThis.__ompBtwRegistry` is the module's anchor, so it is reset between
 * tests instead of relying on a fresh module registry.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getDb } from '@/server/db.server';
import { appendBtwTurn, createBtwTopic, getBtwTopic } from '@/server/lib/btw/store.server';
import {
  btwStateFor,
  ensureBtwRuntime,
  findRunningBtwRuntime,
  forgetBtwRuntime,
  getBtwRuntime,
  publishBtw,
  publishBtwState,
  subscribeBtw,
} from '@/server/lib/btw/registry.server';
import type { BtwFrame, ChatMessageData } from '@/shared/types';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ompchamber-test-'));
  dirs.push(dir);
  return dir;
}

function useTempDb(): void {
  Bun.env.OMPCHAMBER_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__ompChamberDb = undefined;
}

function context(topicId: string, sessionId = 's1') {
  return { topicId, sessionId, parentSessionFile: '/nonexistent/parent.jsonl', cwd: '/tmp' };
}

afterEach(() => {
  globalThis.__ompChamberDb?.resolved?.raw.close();
  globalThis.__ompChamberDb = undefined;
  globalThis.__ompBtwRegistry = undefined;
  delete Bun.env.OMPCHAMBER_DB_PATH;
  delete Bun.env.SYNC_WORKSPACE;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

describe('runtime registry', () => {
  test('ensureBtwRuntime is keyed by topic and forgetBtwRuntime drops it', () => {
    const first = ensureBtwRuntime(context('t1'));
    expect(ensureBtwRuntime(context('t1'))).toBe(first);
    expect(getBtwRuntime('t1')).toBe(first);

    const second = ensureBtwRuntime(context('t2'));
    expect(second).not.toBe(first);
    expect(getBtwRuntime('t2')).toBe(second);

    forgetBtwRuntime('t1');
    expect(getBtwRuntime('t1')).toBeUndefined();
    expect(getBtwRuntime('t2')).toBe(second);
  });

  test('findRunningBtwRuntime reports only a runtime carrying a turn', () => {
    const idle = ensureBtwRuntime(context('t1', 's1'));
    const running = ensureBtwRuntime(context('t2', 's1'));
    expect(findRunningBtwRuntime('s1')).toBeUndefined();

    // Settling is not running: the turn index is already cleared there.
    idle.settling = true;
    expect(findRunningBtwRuntime('s1')).toBeUndefined();

    running.turnIndex = 0;
    expect(findRunningBtwRuntime('s1')).toBe(running);
    // The rule is per session, not global.
    expect(findRunningBtwRuntime('s2')).toBeUndefined();
  });
});

describe('frame fan-out', () => {
  test('publishBtw reaches every subscriber of that session only', () => {
    const mine: BtwFrame[] = [];
    const theirs: BtwFrame[] = [];
    subscribeBtw('s1', (frame) => mine.push(frame));
    subscribeBtw('s2', (frame) => theirs.push(frame));

    publishBtw('s1', { type: 'btw_activity', topicId: 't1', verb: 'thinking' });
    expect(mine).toHaveLength(1);
    expect(theirs).toEqual([]);
  });

  test('unsubscribing removes the listener and cleans up the empty set', () => {
    const frames: BtwFrame[] = [];
    const off = subscribeBtw('s1', (frame) => frames.push(frame));
    off();
    expect(globalThis.__ompBtwRegistry?.listeners.has('s1')).toBe(false);

    publishBtw('s1', { type: 'connected', sessionId: 's1' });
    expect(frames).toEqual([]);
  });

  test('a throwing subscriber does not starve the others', () => {
    const seen: string[] = [];
    subscribeBtw('s1', () => {
      throw new Error('socket closed');
    });
    subscribeBtw('s1', (frame) => seen.push(frame.type));

    publishBtw('s1', { type: 'connected', sessionId: 's1' });
    expect(seen).toEqual(['connected']);
  });
});

describe('btwStateFor', () => {
  test('settles a running turn whose runtime is gone, in the reply and in the database', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');

    const state = await btwStateFor('s1');
    expect(state.topics[0].turns[0].status).toBe('interrupted');
    expect(state.runningTopicId).toBeNull();
    expect(state.live).toBeNull();
    // The repair is persisted, not just returned.
    expect((await getBtwTopic(topic.id))!.turns[0].status).toBe('interrupted');
  });

  test('leaves a live running turn alone and exposes it as the live turn', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    const runtime = ensureBtwRuntime(context(topic.id, 's1'));
    runtime.turnIndex = 0;
    runtime.messages = [{ id: 'm1', role: 'assistant', content: 'half', timestamp: 1 } as unknown as ChatMessageData];
    runtime.activity = 'thinking';

    const state = await btwStateFor('s1');
    expect(state.topics[0].turns[0].status).toBe('running');
    expect(state.runningTopicId).toBe(topic.id);
    expect(state.live).toEqual({
      topicId: topic.id,
      turnIndex: 0,
      messages: runtime.messages,
      activity: 'thinking',
    });
    // Not settled behind the live runtime's back.
    expect((await getBtwTopic(topic.id))!.turns[0].status).toBe('running');
  });

  test('treats a mid-settle runtime as live so it cannot race its own write', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    const runtime = ensureBtwRuntime(context(topic.id, 's1'));
    // The turn index is already cleared, but the settle UPDATE has not landed.
    runtime.settling = true;

    const state = await btwStateFor('s1');
    expect(state.topics[0].turns[0].status).toBe('running');
    expect(state.runningTopicId).toBe(topic.id);
    expect(state.live).toBeNull();
    expect((await getBtwTopic(topic.id))!.turns[0].status).toBe('running');
  });

  test('a finished turn is never touched by the repair', async () => {
    useTempDb();
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');
    await (await getDb()).run("UPDATE btw_turns SET status = 'complete' WHERE topic_id = ?", [topic.id]);

    const state = await btwStateFor('s1');
    expect(state.topics[0].turns[0].status).toBe('complete');
    expect(state.runningTopicId).toBeNull();
  });

  test('publishBtwState pushes the repaired state to subscribers', async () => {
    useTempDb();
    const frames: BtwFrame[] = [];
    subscribeBtw('s1', (frame) => frames.push(frame));
    const topic = await createBtwTopic({ sessionId: 's1', title: 't' });
    await appendBtwTurn(topic.id, 'q');

    await publishBtwState('s1');

    expect(frames).toHaveLength(1);
    const frame = frames[0];
    expect(frame.type).toBe('btw_state');
    if (frame.type === 'btw_state') {
      expect(frame.state.topics[0].id).toBe(topic.id);
      expect(frame.state.topics[0].turns[0].status).toBe('interrupted');
    }
  });
});
