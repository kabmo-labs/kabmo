/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The probe's timing rules: replay a silent transcript, report NEW evidence,
 * and after a quiet window ask the agent to continue instead of waiting for the
 * operator.
 */

import { describe, expect, test } from 'bun:test';
import { AcpBackgroundProbe } from './background-probe';

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

  test('a silent replay asks the agent to continue once, after the quiet window', async () => {
    const clock = timers();
    let now = 0;
    let pulls = 0;
    const emitted: string[] = [];
    const probe = new AcpBackgroundProbe({
      load: async () => ({}),
      resetIdle: () => {},
      emit: (text) => emitted.push(text),
      pull: () => {
        pulls += 1;
      },
      pullAfterMs: 25,
      firstDelayMs: 10,
      maxDelayMs: 40,
      now: () => now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('');
    now = 10;
    clock.next()?.fn();
    await settle();
    expect(pulls).toBe(0);
    now = 20;
    clock.next()?.fn();
    await settle();
    expect(pulls).toBe(0);
    // The probe has backed off to 40 ms; the quiet window opens at 25.
    now = 65;
    clock.next()?.fn();
    await settle();
    expect(pulls).toBe(1);
    expect(emitted).toEqual([]);
    // One pull is the whole budget: no timer is left to try again.
    expect(clock.pending()).toHaveLength(0);
  });

  test('work the replay DID carry delays the pull instead of racing it', async () => {
    const clock = timers();
    let now = 0;
    let pulls = 0;
    let replay = 0;
    let probe!: AcpBackgroundProbe;
    probe = new AcpBackgroundProbe({
      load: async () => {
        replay += 1;
        probe.consume('session/update', textChunk('user_message_chunk', 'buat gambar'));
        if (replay === 1) {
          probe.consume('session/update', chunk({
            sessionUpdate: 'tool_call',
            toolCallId: 'child-1',
            name: 'read_file',
            status: 'completed',
          }));
        }
        return {};
      },
      resetIdle: () => {},
      emit: () => {},
      pull: () => {
        pulls += 1;
      },
      pullAfterMs: 25,
      firstDelayMs: 10,
      maxDelayMs: 40,
      now: () => now,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('');
    now = 10;
    clock.next()?.fn();
    await settle();
    // The child's call re-armed the quiet window at 10 + 25.
    now = 30;
    clock.next()?.fn();
    await settle();
    expect(pulls).toBe(0);
    now = 40;
    clock.next()?.fn();
    await settle();
    expect(pulls).toBe(1);
  });

  test('a stopped probe never pulls', async () => {
    const clock = timers();
    let pulls = 0;
    const probe = new AcpBackgroundProbe({
      load: async () => ({}),
      resetIdle: () => {},
      emit: () => {},
      pull: () => {
        pulls += 1;
      },
      pullAfterMs: 25,
      firstDelayMs: 10,
      now: () => 100,
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    probe.start('');
    clock.next()?.fn();
    await settle();
    probe.stop();
    expect(clock.pending()).toHaveLength(0);
    expect(pulls).toBe(0);
  });
});