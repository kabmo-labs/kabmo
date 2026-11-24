/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's dictation pipeline, from the microphone to the socket.
 *
 * The reported bug: in the macOS shell the mic button recorded for as long as
 * the user held it and then said "No speech was detected in that recording."
 * The capture unit had failed to start (`BaseAudioCaptureUnit::captureFailed`
 * ends the track) and every sample was zero, so the sentence blamed the speaker
 * for a dead device. Two things had to change and both are pinned here:
 *
 * - the utterance is refused as NO AUDIO when it is bit-exact zeros, before the
 *   silence floor can answer "no speech";
 * - a real capture still reaches the socket as ONE 16 kHz PCM16 frame, which is
 *   the hand-off this file's fake `AudioContext` exists to prove — the device
 *   rate (48 kHz here) is resampled on the way out, not assumed.
 *
 * `AudioContext`, `getUserMedia` and `WebSocket` are fakes because `bun test` has
 * no microphone; everything between them is the shipped code.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { UseSpeechToTextReturn } from '@/client/hooks/chat/composer/speech-to-text';
import type { DictationConfig } from '@/shared/lib/dictation/settings';

const CONFIG: DictationConfig = {
  engine: 'omp',
  model: '',
  language: 'en',
  baseUrl: '',
  prompt: '',
  deviceId: '',
  minMs: 300,
  maxMs: 120_000,
};

const DEVICE_RATE = 48_000;
/** 0.5 s of a 220 Hz tone at the device rate: 24 000 samples, well over `minMs`. */
const TONE = Float32Array.from({ length: DEVICE_RATE / 2 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / DEVICE_RATE) * 0.2);
const ZEROS = new Float32Array(DEVICE_RATE / 2);

type ProcessHandler = (event: { inputBuffer: { getChannelData: () => Float32Array } }) => void;

/** The one node the test drives: whatever the hook sets as `onaudioprocess`. */
class FakeProcessor {
  static last: FakeProcessor | null = null;
  onaudioprocess: ProcessHandler | null = null;
  constructor() {
    FakeProcessor.last = this;
  }
  connect() {}
  disconnect() {}
  /** One render quantum of `samples`. */
  deliver(samples: Float32Array) {
    this.onaudioprocess?.({ inputBuffer: { getChannelData: () => samples } });
  }
}

class FakeNode {
  connect() {}
  disconnect() {}
}

class FakeAudioContext {
  static last: FakeAudioContext | null = null;
  readonly sampleRate = DEVICE_RATE;
  readonly state = 'running';
  readonly destination = new FakeNode();
  closed = false;
  constructor() {
    FakeAudioContext.last = this;
  }
  async resume() {}
  createMediaStreamSource() {
    return new FakeNode();
  }
  createScriptProcessor() {
    return new FakeProcessor();
  }
  createGain() {
    return Object.assign(new FakeNode(), { gain: { value: 1 } });
  }
  async close() {
    this.closed = true;
  }
}

class FakeTrack {
  readyState = 'live';
  stop() {
    this.readyState = 'ended';
  }
  addEventListener() {}
}

/** What the hook sends, and what the server would answer. */
class FakeSocket {
  static last: FakeSocket | null = null;
  readonly url: string;
  readonly sent: ArrayBuffer[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  binaryType = 'blob';

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }

  send(data: ArrayBuffer) {
    this.sent.push(data);
  }

  /** The handshake completing; the hook sends the utterance from `onopen`. */
  open() {
    this.onopen?.();
  }

  close() {
    this.closed = true;
  }

  /** The server's side of one frame. */
  answer(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

const realAudioContext = globalThis.AudioContext;
const realWebSocket = globalThis.WebSocket;
const realMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
let permissionError: DOMException | null = null;

function installFakes() {
  FakeProcessor.last = null;
  FakeAudioContext.last = null;
  FakeSocket.last = null;
  globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (permissionError) throw permissionError;
        return { getTracks: () => [new FakeTrack()], getAudioTracks: () => [new FakeTrack()] };
      },
    },
  });
}

function restoreFakes() {
  globalThis.AudioContext = realAudioContext;
  globalThis.WebSocket = realWebSocket;
  if (realMediaDevices) Object.defineProperty(navigator, 'mediaDevices', realMediaDevices);
  else delete (navigator as unknown as { mediaDevices?: unknown }).mediaDevices;
}

let container: HTMLElement | undefined;
let api: UseSpeechToTextReturn | null = null;
let results: string[] = [];
let useSpeechToText: (options: { onResult: (text: string) => void; config: DictationConfig }) => UseSpeechToTextReturn;

beforeAll(async () => {
  // Dynamic on purpose: these modules capture `document`/`navigator` when they
  // load, and a static import is evaluated before any hook below runs — the
  // window this file installs would arrive too late (the documented exception in
  // `use-draft.test.ts`).
  installDomGlobals(new Window({ url: 'http://127.0.0.1/' }));
  ({ useSpeechToText } = await import('@/client/hooks/chat/composer/speech-to-text'));
});

beforeEach(() => {
  api = null;
  results = [];
  permissionError = null;
  installFakes();
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  restoreFakes();
});

afterAll(() => {
  restoreDomGlobals();
});

/** Mount the hook and hand back its latest API. */
async function mount() {
  function Probe() {
    api = useSpeechToText({ onResult: (text) => results.push(text), config: CONFIG });
    return null;
  }
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, null), container!);
  });
  return api!;
}

/** Let the capture's promises settle: `getUserMedia` and `resume` are awaited. */
async function flush() {
  await act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });
}

/** Press the mic, feed one quantum of `chunk`, and release it. */
async function record(chunk: Float32Array) {
  await act(async () => {
    api!.startListening();
  });
  await flush();
  expect(api!.isListening).toBe(true);
  await act(async () => {
    FakeProcessor.last!.deliver(chunk);
  });
  await act(async () => {
    api!.stopListening();
  });
}

describe('useSpeechToText', () => {
  test('a real capture is sent as ONE 16 kHz PCM16 frame', async () => {
    await mount();
    await record(TONE);

    const socket = FakeSocket.last!;
    // Nothing is sent before the socket is open.
    expect(socket.sent).toHaveLength(0);
    await act(async () => {
      socket.open();
    });
    expect(socket.sent).toHaveLength(1);
    // 0.5 s at the device rate becomes 0.5 s at the rate every engine takes.
    expect(socket.sent[0].byteLength).toBe(16_000 * 2 * 0.5);
    // The query string carries the engine and language, never the audio.
    expect(socket.url).toContain('engine=omp');
    expect(socket.url).toContain('language=en');

    await act(async () => {
      socket.answer({ type: 'final', text: 'hello there' });
    });
    expect(results).toEqual(['hello there']);
    expect(api!.isTranscribing).toBe(false);
  });

  test('a dead capture never opens a socket and names the device', async () => {
    await mount();
    await record(ZEROS);

    expect(FakeSocket.last).toBeNull();
    expect(api!.error).toBe('The microphone sent no audio — check the input device in Settings → Dictation.');
    expect(api!.isTranscribing).toBe(false);
  });

  test('a quiet room is still "no speech", not a dead device', async () => {
    await mount();
    // The measured floor of a working microphone in silence (~0.0009 RMS).
    await record(Float32Array.from({ length: DEVICE_RATE / 2 }, (_, i) => (i % 2 ? 1 : -1) * 0.0009));

    expect(FakeSocket.last).toBeNull();
    expect(api!.error).toBe('No speech was detected in that recording.');
  });

  test('a tap under the minimum is refused before anything is sent', async () => {
    await mount();
    await record(Float32Array.from({ length: 1_600 }, () => 0.2));

    expect(FakeSocket.last).toBeNull();
    expect(api!.error).toBe('That was too short to transcribe (under 300 ms).');
  });

  test('a refused microphone keeps its own sentence', async () => {
    permissionError = new DOMException('denied', 'NotAllowedError');
    await mount();
    await act(async () => {
      api!.startListening();
    });
    await flush();

    expect(api!.error).toBe('Microphone permission denied.');
    expect(api!.isListening).toBe(false);
  });

  test('a server refusal is shown, and the capture is released', async () => {
    await mount();
    await record(TONE);
    const socket = FakeSocket.last!;
    await act(async () => {
      socket.open();
    });

    await act(async () => {
      socket.answer({ type: 'error', error: 'STT worker exited.', retryable: true });
    });
    expect(api!.error).toBe('STT worker exited.');
    expect(api!.isTranscribing).toBe(false);
    expect(FakeAudioContext.last?.closed).toBe(true);
  });
});
