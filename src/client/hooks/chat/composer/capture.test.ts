/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The capture graph, driven through fake Web Audio objects.
 *
 * Every case names a failure that a real macOS shell produced, and each one is
 * silent in a different way: a device bind that fails (the graph starts, every
 * sample is zero), a context that never runs (no callbacks at all), and a track
 * that ends underneath the page. The fakes are small on purpose — the assertion
 * is on the ARGUMENT the page sends and the SAMPLES it keeps, not on the graph's
 * shape, because a fake that mirrored Web Audio would let a wrong call pass.
 */

import { afterEach, describe, expect, test, vi } from 'bun:test';
import { openCapture } from '@/client/hooks/chat/composer/capture';

type Listener = () => void;

class FakeTrack {
  readyState: 'live' | 'ended' = 'live';
  stopped = false;
  private listeners: Listener[] = [];

  addEventListener(_type: string, listener: Listener) {
    this.listeners.push(listener);
  }

  /** The device going away — not the page's own teardown. */
  end() {
    this.readyState = 'ended';
    for (const listener of this.listeners) listener();
  }

  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
}

class FakeNode {
  readonly connections: unknown[] = [];
  disconnected = false;

  connect(target: unknown) {
    this.connections.push(target);
  }

  disconnect() {
    this.disconnected = true;
  }
}

class FakeProcessor extends FakeNode {
  onaudioprocess: ((event: AudioProcessingEvent) => void) | null = null;

  /** One render quantum of `samples`, the shape the node hands the callback. */
  deliver(samples: Float32Array) {
    this.onaudioprocess?.({
      inputBuffer: { getChannelData: () => samples },
    } as unknown as AudioProcessingEvent);
  }
}

class FakeGain extends FakeNode {
  readonly gain = { value: 1 };
}

class FakeContext {
  static last: FakeContext | null = null;
  state: AudioContextState = 'running';
  sampleRate = 48_000;
  closed = false;
  processor: FakeProcessor | null = null;
  readonly destination = new FakeNode();
  /**
   * True when `resume()` resolves without starting the context — what a page
   * that is not allowed to autoplay sees: the promise settles, the state stays
   * `suspended`, and no callback ever runs.
   */
  static refuseResume = false;

  constructor() {
    FakeContext.last = this;
  }

  async resume() {
    if (!FakeContext.refuseResume) this.state = 'running';
  }

  createMediaStreamSource() {
    return new FakeNode();
  }

  createScriptProcessor() {
    this.processor = new FakeProcessor();
    return this.processor;
  }

  createGain() {
    return new FakeGain();
  }

  async close() {
    this.closed = true;
  }
}

const realAudioContext = globalThis.AudioContext;
/**
 * `navigator.mediaDevices` does not exist under `bun test`; the module under
 * test only reads `getUserMedia`, so the fake installs exactly that and the
 * original property descriptor is restored afterwards.
 */
const realMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

/** The one member of `MediaDevices` this module calls. */
interface CaptureDevices {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
}

function setDevices(devices: CaptureDevices) {
  Object.defineProperty(navigator, 'mediaDevices', { value: devices, configurable: true });
}

interface Harness {
  stream: MediaStream;
  track: FakeTrack;
  constraints: MediaStreamConstraints | null;
}

/** Install the fakes for one case; `state` is what the new context reports. */
function install(state: AudioContextState = 'running'): Harness {
  const track = new FakeTrack();
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream;
  const harness: Harness = { stream, track, constraints: null };

  globalThis.AudioContext = class extends FakeContext {
    constructor() {
      super();
      this.state = state;
    }
  } as unknown as typeof AudioContext;

  setDevices({
    getUserMedia: async (constraints) => {
      harness.constraints = constraints;
      return stream;
    },
  });
  return harness;
}

function restore() {
  globalThis.AudioContext = realAudioContext;
  FakeContext.refuseResume = false;
  if (realMediaDevices) Object.defineProperty(navigator, 'mediaDevices', realMediaDevices);
  else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
}

// Every case installs process-wide fakes; a case that throws must not leak them
// into the next one.
afterEach(restore);

const noEvents = { onDead: () => {} };

describe('openCapture', () => {
  test('asks for the constraints that keep WebKit capture alive', async () => {
    const harness = install();
    const capture = await openCapture('  dev-7  ', () => {}, noEvents);

    const audio = harness.constraints?.audio as MediaTrackConstraints;
    // The value that decides whether WebKit builds a VoiceProcessingIO unit,
    // whose device bind failed on this machine and ended the track.
    expect(audio.echoCancellation).toBe(false);
    expect(audio.deviceId).toEqual({ exact: 'dev-7' });
    capture?.release();
  });

  test('no stored device means no device constraint', async () => {
    const harness = install();
    const capture = await openCapture('', () => {}, noEvents);
    expect((harness.constraints?.audio as MediaTrackConstraints).deviceId).toBeUndefined();
    capture?.release();
  });

  test('release returns what was captured and stops the microphone', async () => {
    const harness = install();
    const capture = await openCapture('', () => {}, noEvents);
    FakeContext.last?.processor?.deliver(Float32Array.from([0.5, -0.5]));

    const chunks = capture?.release() ?? [];
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual([0.5, -0.5]);
    expect(harness.track.stopped).toBe(true);
    expect(FakeContext.last?.closed).toBe(true);
  });

  test('a track that ends under the page is reported as dead', async () => {
    const harness = install();
    let dead = 0;
    const capture = await openCapture('', () => {}, { onDead: () => (dead += 1) });
    harness.track.end();
    expect(dead).toBe(1);
    capture?.release();
  });

  test('the page’s own teardown is NOT a dead capture', async () => {
    const harness = install();
    let dead = 0;
    const capture = await openCapture('', () => {}, { onDead: () => (dead += 1) });
    capture?.release();
    expect(harness.track.stopped).toBe(true);
    expect(dead).toBe(0);
  });

  test('a track that ended before the graph was built is a failed open', async () => {
    const harness = install();
    harness.track.readyState = 'ended';
    const failures: string[] = [];
    const capture = await openCapture('', (message) => failures.push(message), noEvents);
    expect(capture).toBeNull();
    expect(failures).toEqual(['The microphone sent no audio — check the input device in Settings → Dictation.']);
  });

  test('a context that will not run fails instead of recording zeros', async () => {
    FakeContext.refuseResume = true;
    install('suspended');
    const failures: string[] = [];
    const capture = await openCapture('', (message) => failures.push(message), noEvents);
    expect(capture).toBeNull();
    expect(failures).toEqual(['Could not start audio capture.']);
  });

  test('a refused permission keeps its own sentence', async () => {
    install();
    setDevices({
      getUserMedia: async () => {
        throw new DOMException('denied', 'NotAllowedError');
      },
    });
    const failures: string[] = [];
    const capture = await openCapture('', (message) => failures.push(message), noEvents);
    expect(capture).toBeNull();
    expect(failures).toEqual(['Microphone permission denied.']);
  });

  test('a stream of bit-exact zeros is reported dead without waiting for release', async () => {
    vi.useFakeTimers();
    try {
      install();
      let dead = 0;
      const capture = await openCapture('', () => {}, { onDead: () => (dead += 1) });
      FakeContext.last?.processor?.deliver(new Float32Array(4096));
      expect(dead).toBe(0);

      vi.advanceTimersByTime(450);
      expect(dead).toBe(1);
      capture?.release();
    } finally {
      vi.useRealTimers();
    }
  });

  test('a stream with real samples is left alone', async () => {
    vi.useFakeTimers();
    try {
      install();
      let dead = 0;
      const capture = await openCapture('', () => {}, { onDead: () => (dead += 1) });
      FakeContext.last?.processor?.deliver(new Float32Array(4096).fill(0.02));

      vi.advanceTimersByTime(450);
      expect(dead).toBe(0);
      capture?.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
