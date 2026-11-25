/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The player's own contract: an answer is split at the engine's budget, each
 * chunk is fetched once, playback runs in order, and the snapshot returns to
 * idle at the end.
 *
 * Audio and fetch are fakes. What is pinned is the sequence Kabmo controls —
 * chunk boundaries, the `/api/tts/speak` body, and the cache — not the browser's
 * decoder.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ttsPlayer, type TtsSnapshot } from '@/client/lib/tts/player';
import { DEFAULT_TTS_CONFIG } from '@/shared/lib/tts/settings';

const originalFetch = globalThis.fetch;
const originalAudio = globalThis.Audio;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;

let requests: Array<{ text: string; config: Record<string, unknown> }> = [];

class FakeAudio {
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  play(): Promise<void> {
    queueMicrotask(() => this.onended?.());
    return Promise.resolve();
  }
  pause(): void {}
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  load(): void {}
}

/** An element whose playback only ends when the test says so. */
class ManualAudio {
  static instances: ManualAudio[] = [];
  /** Fires for each element the player creates, so a test can await the next chunk. */
  static created: ((audio: ManualAudio) => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = '';
  playCalls = 0;
  pauseCalls = 0;
  constructor() {
    ManualAudio.instances.push(this);
    ManualAudio.created?.(this);
  }
  play(): Promise<void> {
    this.playCalls += 1;
    return Promise.resolve();
  }
  pause(): void {
    this.pauseCalls += 1;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.src = '';
  }
  load(): void {}
  end(): void {
    this.onended?.();
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
  ManualAudio.instances = [];
  ManualAudio.created = null;
  ttsPlayer.stop();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { text: string; config: Record<string, unknown> };
    requests.push(body);
    return new Response(new Blob([new Uint8Array([1])]), { headers: { 'content-type': 'audio/mpeg' } });
  }) as unknown as typeof fetch;
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  URL.createObjectURL = () => 'blob:test';
  URL.revokeObjectURL = () => {};
});

afterEach(() => {
  ttsPlayer.stop();
  globalThis.fetch = originalFetch;
  globalThis.Audio = originalAudio;
  URL.createObjectURL = originalCreate;
  URL.revokeObjectURL = originalRevoke;
});

describe('ttsPlayer', () => {
  test('splits an answer at the engine budget and returns to idle', async () => {
    const text = Array.from({ length: 40 }, (_, index) => `Sentence number ${index + 1} is here.`).join(' ');
    const settled = waitFor((snapshot) => snapshot.status === 'idle' && snapshot.activeKey === null);

    ttsPlayer.speak(text, 'run-1', { ...DEFAULT_TTS_CONFIG, engine: 'openai' });
    const snapshot = await settled;

    expect(snapshot).toEqual({ status: 'idle', activeKey: null, error: null });
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

  test('pause holds the read and never starts the next chunk', async () => {
    globalThis.Audio = ManualAudio as unknown as typeof Audio;
    const nextChunk = Promise.withResolvers<ManualAudio>();
    ManualAudio.created = () => {
      if (ManualAudio.instances.length === 2) nextChunk.resolve(ManualAudio.instances[1]!);
    };
    const text = Array.from({ length: 30 }, (_, index) => `Sentence number ${index + 1} is here.`).join(' ');

    ttsPlayer.speak(text, 'run-1', { ...DEFAULT_TTS_CONFIG, engine: 'openai' });
    await waitFor((snapshot) => snapshot.status === 'playing');
    const first = ManualAudio.instances[0];
    expect(first).toBeDefined();

    ttsPlayer.pause();
    expect(ttsPlayer.getSnapshot()).toEqual({ status: 'paused', activeKey: 'run-1', error: null });
    expect(first!.pauseCalls).toBe(1);

    // The chunk ends while paused: the next one must be loaded but silent.
    first!.end();
    const second = await nextChunk.promise;
    expect(ttsPlayer.getSnapshot().status).toBe('paused');
    expect(second.playCalls).toBe(0);

    ttsPlayer.resume();
    expect(ttsPlayer.getSnapshot().status).toBe('playing');
    expect(second.playCalls).toBe(1);
    ttsPlayer.stop();
  });
});
