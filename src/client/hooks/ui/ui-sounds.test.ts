/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The notification-sound surface: the two chimes, their preference gate,
 * and the chat-completion trigger. The synth surface is a fake `AudioContext`
 * that records instead of playing. The waiting-session alert moved to
 * `ui-alert.test.ts` so both files stay under the 350-line ceiling. */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'preact/test-utils';
import {
  isChatSoundEnabled,
  playInputRequiredSound,
  playNotificationSound,
  triggerChatCompletionSound,
} from '@/client/hooks/ui/notification-sound';
import { primeKabmoSettings } from '@/shared/lib/settings/client';

const DOM_GLOBALS = ['window', 'document', 'navigator'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  jest.useRealTimers();
  FakeAudioContext.instances.length = 0;
  (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
});
/** The alert mounts the real hook, so every constructed context is a cue. */

/** The synth surface the sound hooks touch, recorded instead of played. */
class FakeParam {
  readonly events: Array<[string, number, number]> = [];
  setValueAtTime(value: number, time: number) {
    this.events.push(['set', value, time]);
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(['linear', value, time]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push(['exp', value, time]);
    return this;
  }
}

class FakeOscillator {
  type = '';
  readonly frequency = new FakeParam();
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  readonly connections: unknown[] = [];
  connect(node: unknown) {
    this.connections.push(node);
  }
  start(time: number) {
    this.started.push(time);
  }
  stop(time: number) {
    this.stopped.push(time);
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  readonly connections: unknown[] = [];
  connect(node: unknown) {
    this.connections.push(node);
  }
}

class FakeAudioContext {
  static readonly instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  readonly currentTime = 0;
  readonly destination = { name: 'destination' };
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  resumes = 0;
  closes = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.resumes += 1;
    return Promise.resolve();
  }
  close() {
    this.closes += 1;
    return Promise.resolve();
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

/** The single context the last cue built. */
function lastContext(): FakeAudioContext {
  const ctx = FakeAudioContext.instances.at(-1);
  if (!ctx) throw new Error('no audio context was constructed');
  return ctx;
}

describe('playNotificationSound', () => {
  test('builds two climbing sine tones and resumes a suspended context', () => {
    (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
    playNotificationSound();

    const ctx = lastContext();
    expect(ctx.resumes).toBe(1);
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((o) => o.type)).toEqual(['sine', 'sine']);

    const [low, high] = ctx.oscillators;
    expect(low.frequency.events).toEqual([
      ['set', 587.33, 0],
      ['exp', 880, 0.1],
    ]);
    expect(high.frequency.events).toEqual([
      ['set', 880, 0.06],
      ['exp', 1174.66, 0.18],
    ]);
    expect(low.started).toEqual([0]);
    expect(low.stopped).toEqual([0.32]);
    expect(high.started).toEqual([0.06]);
    expect(high.stopped).toEqual([0.42]);

    // Each tone runs through its own gain into the destination.
    expect(low.connections).toEqual([ctx.gains[0]]);
    expect(ctx.gains[0].connections).toEqual([ctx.destination]);
    expect(ctx.gains[1].connections).toEqual([ctx.destination]);
  });

  test('closes the context after the tones have finished, not before', () => {
    jest.useFakeTimers();
    (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
    playNotificationSound();

    act(() => {
      jest.advanceTimersByTime(549);
    });
    expect(lastContext().closes).toBe(0);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(lastContext().closes).toBe(1);
  });

  test('a window without Web Audio is a silent no-op', () => {
    (win as unknown as Record<string, unknown>).AudioContext = undefined;
    expect(() => playNotificationSound()).not.toThrow();
    expect(FakeAudioContext.instances).toEqual([]);
  });
});

describe('playInputRequiredSound', () => {
  test('steps two triangle tones down, the mirror of the completion chime', () => {
    (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
    playInputRequiredSound();

    const ctx = lastContext();
    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((o) => o.type)).toEqual(['triangle', 'triangle']);
    expect(ctx.oscillators.map((o) => o.frequency.events)).toEqual([
      [['set', 880, 0]],
      [['set', 659.25, 0.16]],
    ]);
    expect(ctx.oscillators[1].started).toEqual([0.16]);
    expect(ctx.oscillators[1].stopped).toEqual([0.62]);
    expect(ctx.gains[0].gain.events).toEqual([
      ['set', 0, 0],
      ['linear', 0.11, 0.015],
      ['exp', 0.0001, 0.18],
    ]);
  });

  test('closes the context at 800ms', () => {
    jest.useFakeTimers();
    (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
    playInputRequiredSound();

    act(() => {
      jest.advanceTimersByTime(799);
    });
    expect(lastContext().closes).toBe(0);
    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(lastContext().closes).toBe(1);
  });
});

describe('isChatSoundEnabled', () => {
  test('defaults to on when no preference is stored', () => {
    primeKabmoSettings({});
    expect(isChatSoundEnabled()).toBe(true);
  });

  test('an explicit false on either key mutes it, with chatCompletionSound first', () => {
    primeKabmoSettings({ chatCompletionSound: false });
    expect(isChatSoundEnabled()).toBe(false);

    primeKabmoSettings({ soundAlerts: false });
    expect(isChatSoundEnabled()).toBe(false);

    // The newer key wins over the legacy alias.
    primeKabmoSettings({ chatCompletionSound: true, soundAlerts: false });
    expect(isChatSoundEnabled()).toBe(true);

    primeKabmoSettings({ chatCompletionSound: false, soundAlerts: true });
    expect(isChatSoundEnabled()).toBe(false);
  });

  test('triggerChatCompletionSound plays only when enabled', () => {
    primeKabmoSettings({ chatCompletionSound: false });
    triggerChatCompletionSound();
    expect(FakeAudioContext.instances).toEqual([]);

    primeKabmoSettings({ chatCompletionSound: true });
    triggerChatCompletionSound();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});

/** The snapshot and the DOM globals are module/global state shared across the whole `bun test` process. */
afterAll(() => {
  primeKabmoSettings({});
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});
