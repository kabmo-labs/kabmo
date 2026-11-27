/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The player's own contract: an answer is split at the engine's budget, each
 * chunk is fetched once, chunk audio is scheduled back-to-back, and the
 * snapshot returns to idle at the end.
 *
 * Audio is a fake AudioContext. What is pinned is the sequence Kabmo controls —
 * chunk boundaries, the `/api/tts/speak` body, the cache, and the contiguous
 * start times that remove the gap between chunks — not the browser's decoder.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { GaplessAudio } from '@/client/lib/tts/gapless';
import { ttsPlayer, type TtsSnapshot } from '@/client/lib/tts/player';
import { DEFAULT_TTS_CONFIG } from '@/shared/lib/tts/settings';

const originalFetch = globalThis.fetch;
const originalAudioContext = globalThis.AudioContext;

let requests: Array<{ text: string; config: Record<string, unknown> }> = [];

class FakeSource {
  onended: (() => void) | null = null;
  buffer: AudioBuffer | null = null;
  startedAt: number | null = null;
  stopped = false;

  connect(): void {}
  disconnect(): void {}

  start(when: number): void {
    this.startedAt = when;
  }

  stop(): void {
    this.stopped = true;
  }

  end(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.onended?.();
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  static autoEnd = true;

  state: AudioContextState = 'running';
  currentTime = 0;
  destination = {} as AudioDestinationNode;
  sources: FakeSource[] = [];

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    if (FakeAudioContext.autoEnd) queueMicrotask(() => source.end());
    return source as unknown as AudioBufferSourceNode;
  }

  async decodeAudioData(_bytes: ArrayBuffer): Promise<AudioBuffer> {
    return { duration: 1 } as AudioBuffer;
  }

  async suspend(): Promise<void> {
    this.state = 'suspended';
  }

  async resume(): Promise<void> {
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.state = 'closed';
  }
}

function waitFor(predicate: (snapshot: TtsSnapshot) => boolean): Promise<TtsSnapshot> {
  return new Promise((resolve) => {
    const unsubscribe = ttsPlayer.subscribe(() => {
      const snapshot = ttsPlayer.getSnapshot();
      if (!predicate(snapshot)) return;
      unsubscribe();
      resolve(snapshot);
    });
  });
}

beforeEach(() => {
  requests = [];
  FakeAudioContext.instances = [];
  FakeAudioContext.autoEnd = true;
  ttsPlayer.stop();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { text: string; config: Record<string, unknown> };
    requests.push(body);
    return new Response(new Blob([new Uint8Array([1])]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as unknown as typeof fetch;
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
});

afterEach(() => {
  ttsPlayer.stop();
  globalThis.fetch = originalFetch;
  globalThis.AudioContext = originalAudioContext;
});

describe('ttsPlayer', () => {
  test('splits an answer at the engine budget and returns to idle', async () => {
    const text = Array.from({ length: 40 }, (_, index) => `Sentence number ${index + 1} is here.`).join(' ');
    const settled = waitFor((snapshot) => snapshot.status === 'idle' && snapshot.activeKey === null);

    ttsPlayer.speak(text, 'run-1', { ...DEFAULT_TTS_CONFIG, engine: 'openai' });
    const snapshot = await settled;

    expect(snapshot).toEqual({ status: 'idle', activeKey: null, error: null });
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request.text.length).toBeLessThanOrEqual(4096);
      expect(request.config.engine).toBe('openai');
    }
    expect(requests.map((request) => request.text).join(' ')).toContain('Sentence number 40');
  });

  test('a replay of the same chunk does not bill the provider twice', async () => {
    const text = 'One short answer.';
    const first = waitFor((snapshot) => snapshot.status === 'idle' && snapshot.activeKey === null);
    ttsPlayer.speak(text, 'run-1', DEFAULT_TTS_CONFIG);
    await first;
    expect(requests).toHaveLength(1);

    const second = waitFor((snapshot) => snapshot.status === 'idle' && snapshot.activeKey === null);
    ttsPlayer.speak(text, 'run-1', DEFAULT_TTS_CONFIG);
    await second;
    expect(requests).toHaveLength(1);
  });

  test('pause suspends the audio context and resume continues it', async () => {
    FakeAudioContext.autoEnd = false;
    const text = Array.from({ length: 30 }, (_, index) => `Sentence number ${index + 1} is here.`).join(' ');

    ttsPlayer.speak(text, 'run-1', { ...DEFAULT_TTS_CONFIG, engine: 'openai' });
    await waitFor((snapshot) => snapshot.status === 'playing');
    const context = FakeAudioContext.instances.at(-1);
    expect(context).toBeDefined();
    expect(context!.sources.length).toBeGreaterThan(0);

    ttsPlayer.pause();
    expect(ttsPlayer.getSnapshot()).toEqual({ status: 'paused', activeKey: 'run-1', error: null });
    expect(context!.state).toBe('suspended');

    ttsPlayer.resume();
    expect(ttsPlayer.getSnapshot().status).toBe('playing');
    expect(context!.state).toBe('running');
    ttsPlayer.stop();
  });

  test('starts each chunk at the previous chunk end', async () => {
    FakeAudioContext.autoEnd = false;
    const context = new FakeAudioContext();
    const audio = new GaplessAudio(() => context as unknown as AudioContext);

    await audio.ensure();
    await audio.schedule(new Blob([new Uint8Array([1])]));
    await audio.schedule(new Blob([new Uint8Array([2])]));

    expect(context.sources).toHaveLength(2);
    expect(context.sources[0]!.startedAt).toBeCloseTo(0.05, 5);
    expect(context.sources[1]!.startedAt).toBeCloseTo(1.05, 5);

    audio.stop();
  });
});
