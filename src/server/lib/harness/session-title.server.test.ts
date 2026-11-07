/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Naming a chat that runs on another harness.
 *
 * The bug this pins: an ACP agent writes no session file, so the row the sidebar
 * drew for its chat said `Untitled` for the whole life of the conversation —
 * measured on a `claude` chat an hour after its first prompt, while the
 * placeholder row it replaced had shown the user's own words.
 *
 * The rule is `deriveSessionTitle`'s, applied to the two facts Kabmo stores: the
 * agent's own title when it publishes one, else the first prompt. Both writers
 * return their write, so every case here awaits the real completion instead of
 * sleeping on it.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { loadAcpSessions, saveHarnessSession } from '@/server/lib/harness/session-store.server';
import { noteAgentTitle, notePromptTitle, titleFromPrompt } from '@/server/lib/harness/session-title.server';
import { onRealtimeSignal } from '@/server/lib/realtime/signals.server';

/** Run one write and report the signals it raised, in order. */
async function writeAndCollectSignals(write: () => Promise<boolean>): Promise<{ written: boolean; signals: string[] }> {
  const signals: string[] = [];
  const off = onRealtimeSignal((event) => signals.push(event.signal));
  try {
    return { written: await write(), signals };
  } finally {
    off();
  }
}

beforeEach(async () => {
  await isolateDb();
});

afterEach(async () => {
  await releaseDb();
});

describe('titleFromPrompt', () => {
  test('one line, collapsed, bounded', () => {
    expect(titleFromPrompt('  Hello\n\n  world  ')).toBe('Hello world');
    // The bound matches the 120 `sessionTitleFor` keeps of an omp first message.
    expect(titleFromPrompt('x'.repeat(500))).toHaveLength(120);
  });

  test('a message with nothing to show is no title at all', () => {
    expect(titleFromPrompt('   \n  ')).toBe('');
  });
});

describe('naming an ACP chat', () => {
  beforeEach(async () => {
    await saveHarnessSession({ sessionId: 'chat', harness: 'claude', agentSessionId: '', cwd: '/p' });
  });

  test('the first prompt names it and publishes the sidebar once', async () => {
    const result = await writeAndCollectSignals(() => notePromptTitle('chat', 'Ship the release'));

    expect(result).toEqual({ written: true, signals: ['sidebar-structure'] });
    expect((await loadAcpSessions())[0].title).toBe('Ship the release');
  });

  test('a later prompt leaves the name alone, and publishes nothing', async () => {
    await notePromptTitle('chat', 'Ship the release');

    // A steering message or a queue delivery reaches the same call with its own
    // text; renaming the chat to it is the defect this guard exists for.
    const result = await writeAndCollectSignals(() => notePromptTitle('chat', 'and also do this'));
    expect(result).toEqual({ written: false, signals: [] });
    expect((await loadAcpSessions())[0].title).toBe('Ship the release');
  });

  test('the agent’s own title replaces the prompt guess', async () => {
    await notePromptTitle('chat', 'Ship the release');

    const result = await writeAndCollectSignals(() => noteAgentTitle('chat', 'Release train'));
    expect(result).toEqual({ written: true, signals: ['sidebar-structure'] });
    expect((await loadAcpSessions())[0].title).toBe('Release train');
  });

  test('a repeated agent title publishes nothing', async () => {
    await noteAgentTitle('chat', 'Release train');

    expect(await writeAndCollectSignals(() => noteAgentTitle('chat', 'Release train'))).toEqual({
      written: false,
      signals: [],
    });
    // An empty one is not a name, and must not blank the row either.
    expect(await writeAndCollectSignals(() => noteAgentTitle('chat', '   '))).toEqual({
      written: false,
      signals: [],
    });
    expect((await loadAcpSessions())[0].title).toBe('Release train');
  });

  test('an empty prompt names nothing', async () => {
    expect(await writeAndCollectSignals(() => notePromptTitle('chat', '   '))).toEqual({
      written: false,
      signals: [],
    });
    expect((await loadAcpSessions())[0].title).toBe('');
  });
});
