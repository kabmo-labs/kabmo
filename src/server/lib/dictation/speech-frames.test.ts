/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The speech frame codec, pinned against the layout omp's worker actually reads.
 *
 * Every constant here was read out of omp 19.1.1's bundle and then verified on
 * the running worker: a wrong length field, a wrong kind byte or a payload at the
 * wrong offset does not fail loudly — the worker either kills itself or answers a
 * transcript of shifted samples, which reads as "the model is bad" rather than
 * "the transport is bad". So the byte layout is asserted field by field.
 */

import { describe, expect, test } from 'bun:test';
import { SpeechFrameDecoder, encodeSpeechFrame } from '@/server/lib/dictation/speech-frames';

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function decodeOne(bytes: Uint8Array): Record<string, unknown>[] {
  return new SpeechFrameDecoder().push(bytes) as Record<string, unknown>[];
}

describe('encodeSpeechFrame', () => {
  test('a header-only frame is length | 0 | JSON', () => {
    const bytes = encodeSpeechFrame({ type: 'ping', id: '7' });
    const json = JSON.stringify({ type: 'ping', id: '7' });

    expect(view(bytes).getUint32(0, true)).toBe(1 + json.length);
    expect(bytes[4]).toBe(0);
    expect(new TextDecoder().decode(bytes.subarray(5))).toBe(json);
  });

  test('a Float32Array is hoisted into the payload and named by $pcm', () => {
    const audio = new Float32Array([0.5, -0.25, 1]);
    const bytes = encodeSpeechFrame({ type: 'transcribe', id: '1', modelKey: 'whisper-base', audio });

    expect(bytes[4]).toBe(1);
    const headerLength = view(bytes).getUint32(5, true);
    const header = JSON.parse(new TextDecoder().decode(bytes.subarray(9, 9 + headerLength)));
    expect(header).toEqual({ type: 'transcribe', id: '1', modelKey: 'whisper-base', $pcm: 'audio' });
    expect(header).not.toHaveProperty('audio');
    // length excludes the 4-byte prefix and includes the kind byte
    expect(view(bytes).getUint32(0, true)).toBe(bytes.length - 4);
    expect(bytes.length - 4).toBe(1 + 4 + headerLength + audio.byteLength);
  });

  test('the payload is the raw little-endian samples, not JSON', () => {
    const audio = new Float32Array([0.5, -0.25]);
    const bytes = encodeSpeechFrame({ type: 'transcribe', audio });
    const headerLength = view(bytes).getUint32(5, true);
    const payload = new DataView(bytes.buffer, bytes.byteOffset + 9 + headerLength);
    expect(payload.getFloat32(0, true)).toBe(0.5);
    expect(payload.getFloat32(4, true)).toBe(-0.25);
  });
});

describe('SpeechFrameDecoder', () => {
  test('round-trips a header frame', () => {
    const frames = decodeOne(encodeSpeechFrame({ type: 'pong', id: '3' }));
    expect(frames).toEqual([{ type: 'pong', id: '3' }]);
  });

  test('round-trips a payload frame and reattaches the samples', () => {
    const audio = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const frames = decodeOne(encodeSpeechFrame({ type: 'transcribe', id: '9', audio }));
    expect(frames).toHaveLength(1);
    expect(frames[0].id).toBe('9');
    expect(frames[0]).not.toHaveProperty('$pcm');
    expect([...(frames[0].audio as Float32Array)]).toEqual([0.1, 0.2, 0.3, 0.4].map((n) => Math.fround(n)));
  });

  test('reassembles a frame split across reads', () => {
    const bytes = encodeSpeechFrame({ type: 'transcribe', id: '1', audio: new Float32Array([1, 2, 3]) });
    const decoder = new SpeechFrameDecoder();
    // Split mid-payload, which is where a real pipe boundary lands.
    expect(decoder.push(bytes.subarray(0, 12))).toEqual([]);
    const frames = decoder.push(bytes.subarray(12));
    expect(frames).toHaveLength(1);
    expect([...(frames[0].audio as Float32Array)]).toEqual([1, 2, 3]);
  });

  test('reads several frames out of one chunk', () => {
    const first = encodeSpeechFrame({ type: 'pong', id: '1' });
    const second = encodeSpeechFrame({ type: 'transcription', id: '2', text: 'halo' });
    const merged = new Uint8Array(first.length + second.length);
    merged.set(first);
    merged.set(second, first.length);

    const frames = decodeOne(merged);
    expect(frames.map((frame) => frame.type)).toEqual(['pong', 'transcription']);
    expect(frames[1].text).toBe('halo');
  });

  test('an empty frame is rejected rather than skipped', () => {
    const bytes = new Uint8Array([0, 0, 0, 0]);
    expect(() => decodeOne(bytes)).toThrow('empty frame');
  });

  test('an unknown kind is rejected rather than guessed', () => {
    const bytes = new Uint8Array(6);
    new DataView(bytes.buffer).setUint32(0, 2, true);
    bytes[4] = 9;
    expect(() => decodeOne(bytes)).toThrow('unknown type 9');
  });

  test('a payload frame whose header overruns the body is rejected', () => {
    const bytes = new Uint8Array(12);
    new DataView(bytes.buffer).setUint32(0, 8, true);
    bytes[4] = 1;
    new DataView(bytes.buffer).setUint32(5, 99, true);
    expect(() => decodeOne(bytes)).toThrow('overruns frame');
  });

  test('a decoded payload does not keep the read buffer alive', () => {
    const bytes = encodeSpeechFrame({ type: 'transcribe', audio: new Float32Array([0.5]) });
    const frames = decodeOne(bytes);
    const samples = frames[0].audio as Float32Array;
    // A view into the decoder's buffer would be exactly this length; a copy is 4.
    expect(samples.buffer.byteLength).toBe(4);
  });
});
