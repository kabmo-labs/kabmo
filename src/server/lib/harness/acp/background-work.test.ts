/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The delayed-answer probe: antigravity ends a turn when it SPAWNS a subagent
 * and holds the completion until the next request (upstream #1461), so Kabmo
 * replays the transcript with `session/load` and emits only the text the
 * operator has not seen.
 */

import { describe, expect, test } from 'bun:test';
import {
  AcpBackgroundProbe,
  backgroundNotice,
  backgroundNoticeFrames,
  spawnsBackgroundWork,
} from '@/server/lib/harness/acp/background-work';

const toolCall = (name: string) => ({
  role: 'assistant',
  content: [{ type: 'toolCall', id: 't1', name }],
});

const chunk = (update: Record<string, unknown>) => ({ update });
const textChunk = (kind: 'user_message_chunk' | 'agent_message_chunk', text: string) =>
  chunk({ sessionUpdate: kind, content: { type: 'text', text } });

interface FakeTimer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

function isFakeTimer(value: unknown): value is FakeTimer {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fn' in value &&
    'ms' in value &&
    'cancelled' in value &&
    typeof value.fn === 'function' &&
    typeof value.ms === 'number' &&
    typeof value.cancelled === 'boolean'
  );
}

/** The probe arms a timer; cases drive it themselves so nothing sleeps. */
function timers() {
  const scheduled: FakeTimer[] = [];
  return {
    schedule: (fn: () => void, ms: number): unknown => {
      const handle: FakeTimer = { fn, ms, cancelled: false };
      scheduled.push(handle);
      return handle;
    },
    cancel: (handle: unknown): void => {
      if (isFakeTimer(handle)) handle.cancelled = true;
    },
    next: (): FakeTimer | undefined => scheduled.shift(),
    pending: () => scheduled.filter((handle) => !handle.cancelled),
  };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

describe('background work detection', () => {
  test('a spawned subagent tool call is background work', () => {
    expect(spawnsBackgroundWork(toolCall('invoke_subagent'))).toBe(true);
    expect(spawnsBackgroundWork(toolCall('spawn_subagent'))).toBe(true);
  });

  test('an awaited tool call is not', () => {
    expect(spawnsBackgroundWork(toolCall('run_command'))).toBe(false);
    expect(spawnsBackgroundWork({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] })).toBe(false);
    expect(spawnsBackgroundWork(undefined)).toBe(false);
  });
});

describe('delayed notice extraction', () => {
  test('returns only the text past the answer already shown', () => {
    expect(backgroundNotice('Sedang membuat…', 'Sedang membuat…\nBerikut gambarnya')).toBe('Berikut gambarnya');
  });

  test('a replay of the same answer is not a notice', () => {
    expect(backgroundNotice('Sedang membuat…', 'Sedang membuat…')).toBeNull();
  });

  test('a diverged replay is not guessed at', () => {
    expect(backgroundNotice('Sedang membuat…', 'Jawaban lain')).toBeNull();
  });

  test('an empty baseline accepts the whole segment', () => {
    expect(backgroundNotice('', 'Berikut gambarnya')).toBe('Berikut gambarnya');
  });
});

describe('background notice frames', () => {
  test('form a complete run so the client releases its generating flag', () => {
    const frames = backgroundNoticeFrames('Berikut gambarnya');
    expect(frames.map((frame) => frame.type)).toEqual([
      'agent_start',
      'turn_start',
      'message_update',
      'message_end',
      'agent_end',
    ]);
    expect(frames[3]).toMatchObject({
      type: 'message_end',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Berikut gambarnya' }] },
    });
    expect(frames[4]).toMatchObject({ type: 'agent_end', isTerminal: true });
  });
});

describe('AcpBackgroundProbe', () => {
  test('backs off and emits once a replay carries new text', async () => {
    const clock = timers();
    const emitted: string[] = [];
    let probe!: AcpBackgroundProbe;
    const replays = ['Sedang membuat…', 'Sedang membuat…\nBerikut gambarnya', 'Sedang membuat…\nBerikut gambarnya'];
    let attempts = 0;
    probe = new AcpBackgroundProbe({
      load: async () => {
        const text = replays[Math.min(attempts, replays.length - 1)];
        attempts += 1;
        probe.consume('session/update', textChunk('user_message_chunk', 'buat gambar'));
        for (const piece of text.split('\n')) {
          probe.consume('session/update', textChunk('agent_message_chunk', piece));
        }
        return {};
      },
      resetIdle: () => {},
      emit: (text) => emitted.push(text),
      firstDelayMs: 10,
      maxDelayMs: 40,
      now: () => 0,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('Sedang membuat…');
    const first = clock.next();
    expect(first?.ms).toBe(10);
    first?.fn();
    await settle();
    expect(attempts).toBe(1);
    expect(emitted).toEqual([]);
    // No notice yet: the next attempt is scheduled with a doubled delay.
    const second = clock.next();
    expect(second?.ms).toBe(20);
    second?.fn();
    await settle();
    expect(attempts).toBe(2);
    // A first sighting is a prefix while the agent is still writing.
    expect(emitted).toEqual([]);
    const third = clock.next();
    expect(third?.ms).toBe(10);
    third?.fn();
    await settle();
    expect(attempts).toBe(3);
    expect(emitted).toEqual(['Berikut gambarnya']);
    expect(clock.pending()).toHaveLength(0);
  });

  test('swallows the replay, and stops swallowing once its load resolves', async () => {
    const clock = timers();
    const deferred = Promise.withResolvers<unknown>();
    let probe!: AcpBackgroundProbe;
    probe = new AcpBackgroundProbe({
      load: () => deferred.promise,
      resetIdle: () => {},
      emit: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    expect(probe.consume('session/update', textChunk('agent_message_chunk', 'x'))).toBe(false);
    probe.start('wait');
    clock.next()?.fn();
    await settle();
    expect(probe.consume('session/update', textChunk('agent_message_chunk', 'replay'))).toBe(true);

    deferred.resolve({});
    await settle();
    expect(probe.consume('session/update', textChunk('agent_message_chunk', 'live'))).toBe(false);
  });

  test('a stopped probe still swallows the replay its load is waiting on', async () => {
    const clock = timers();
    const deferred = Promise.withResolvers<unknown>();
    let probe!: AcpBackgroundProbe;
    probe = new AcpBackgroundProbe({
      load: () => deferred.promise,
      resetIdle: () => {},
      emit: () => {},
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('wait');
    clock.next()?.fn();
    await settle();
    probe.stop();
    expect(probe.consume('session/update', textChunk('agent_message_chunk', 'replay'))).toBe(true);
    deferred.resolve({});
    await settle();
    expect(probe.consume('session/update', textChunk('agent_message_chunk', 'live'))).toBe(false);
  });

  test('retries a failed load, then gives up instead of spinning', async () => {
    const clock = timers();
    let loads = 0;
    const probe = new AcpBackgroundProbe({
      load: async () => {
        loads += 1;
        throw new Error('session/load is busy');
      },
      resetIdle: () => {},
      emit: () => {},
      timeoutMs: 60_000,
      firstDelayMs: 10,
      now: () => 0,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('wait');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      clock.next()?.fn();
      await settle();
      expect(loads).toBe(attempt);
    }
    expect(clock.pending()).toHaveLength(0);
  });

  test('gives up at its deadline instead of polling forever', async () => {
    const clock = timers();
    let loads = 0;
    const probe = new AcpBackgroundProbe({
      load: async () => {
        loads += 1;
        return {};
      },
      resetIdle: () => {},
      emit: () => {},
      timeoutMs: 0,
      firstDelayMs: 10,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('wait');
    clock.next()?.fn();
    await settle();
    expect(loads).toBe(1);
    expect(clock.pending()).toHaveLength(0);
  });
});
