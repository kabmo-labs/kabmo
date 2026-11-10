/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A turn that spawns a subagent is not over when `session/prompt` resolves:
 * antigravity holds the subagent's completion until the next request, so the
 * session probes `session/load` and delivers the delayed answer as a follow-up
 * run. This suite drives that wiring through the real probe and the session's
 * own notification seam.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { mountSession, notify } from '@/server/lib/harness/acp/session.test-util';
import { AcpBackgroundProbe, deliverBackgroundNotice } from '@/server/lib/harness/acp/background-work';
import { extractTextFromContent } from '@/shared/lib/omp/session/mapper';

interface FakeTimer {
  fn: () => void;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

describe('ACP background subagent notice', () => {
  beforeEach(async () => {
    await isolateDb();
  });

  afterEach(async () => {
    await releaseDb();
  });

  test('a session/load replay delivers the answer past the holding message', async () => {
    const { session, events, turn, setBackground } = mountSession();
    const scheduled: FakeTimer[] = [];
    const delivered: string[] = [];
    const probe = new AcpBackgroundProbe({
      load: async () => {
        notify(session, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'buat gambar' } });
        notify(session, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Sedang membuat gambar…' },
        });
        notify(session, {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'Berikut adalah gambar gunung.' },
        });
        return {};
      },
      resetIdle: () => {},
      emit: (text) => {
        delivered.push(text);
        deliverBackgroundNotice(session, text);
      },
      firstDelayMs: 10,
      schedule: (fn) => {
        const timer: FakeTimer = { fn };
        scheduled.push(timer);
        return timer;
      },
      cancel: () => {},
    });
    setBackground(probe);

    await session.send({ type: 'prompt', message: 'buat gambar' });
    await turn.started;
    notify(session, {
      sessionUpdate: 'tool_call',
      toolCallId: 'sub-1',
      name: 'invoke_subagent',
      title: 'Run invoke_subagent',
      status: 'in_progress',
      rawInput: { Prompt: 'gambar gunung' },
    });
    notify(session, {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Sedang membuat gambar…' },
    });
    turn.finish({ stopReason: 'end_turn' });
    await settle();

    expect(scheduled).toHaveLength(1);
    scheduled[0]?.fn();
    await settle();
    // A first sighting is only a prefix; a repeated replay completes it.
    expect(delivered).toEqual([]);
    expect(scheduled).toHaveLength(2);
    scheduled[1]?.fn();
    await settle();

    // The replay's holding message is swallowed; only its continuation lands.
    expect(delivered).toEqual(['Berikut adalah gambar gunung.']);
    const ends = events.filter((event) => event.type === 'message_end');
    const texts = ends.map((event) => {
      const message = event.message;
      if (!message || typeof message !== 'object' || !('content' in message)) return '';
      return extractTextFromContent(message.content);
    });
    expect(texts.filter((text) => text === 'Sedang membuat gambar…')).toHaveLength(1);
    expect(texts).toContain('Berikut adalah gambar gunung.');
    // The delayed answer arrives as a complete run of its own.
    expect(events.filter((event) => event.type === 'agent_end')).toHaveLength(2);
  });

  test('a new prompt stops the probe before the agent flushes the notice itself', async () => {
    const { session, turn, setBackground } = mountSession();
    let stopped = 0;
    setBackground({
      start: () => {},
      stop: () => {
        stopped += 1;
      },
      consume: () => false,
    });

    await session.send({ type: 'prompt', message: 'satu' });
    await turn.started;
    turn.finish({ stopReason: 'end_turn' });
    await settle();

    const stopsBefore = stopped;
    await session.send({ type: 'prompt', message: 'dua' });
    expect(stopped).toBe(stopsBefore + 1);
  });
});
