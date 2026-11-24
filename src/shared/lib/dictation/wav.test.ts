/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The WAV header every hosted engine receives.
 *
 * Pinned field by field because a wrong one fails in a way nobody reads: a bad
 * `byteRate` makes a provider decode the utterance at the wrong speed (Whisper
 * answers gibberish rather than an error), and a wrong `data` size truncates the
 * last word. The numbers below are the RIFF/WAVE PCM contract, not a
 * transcription of this code.
 */

import { describe, expect, test } from 'bun:test';
import { WAV_HEADER_BYTES, encodeWav } from '@/shared/lib/dictation/wav';

const pcm = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

describe('encodeWav', () => {
  test('writes the 44-byte PCM header for 16 kHz mono', () => {
    const wav = encodeWav(pcm, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + pcm.byteLength);
    expect(ascii(wav, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength);
    expect(ascii(wav, 8, 4)).toBe('WAVE');
    expect(ascii(wav, 12, 4)).toBe('fmt ');
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000); // byteRate = rate * channels * 2
    expect(view.getUint16(32, true)).toBe(2); // blockAlign
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(ascii(wav, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(pcm.byteLength);
  });

  test('the samples follow the header byte for byte', () => {
    const wav = encodeWav(pcm, 16000);
    expect([...wav.subarray(WAV_HEADER_BYTES)]).toEqual([...pcm]);
  });

  test('an odd trailing byte is dropped, because a header cannot describe it', () => {
    const odd = new Uint8Array([1, 2, 3]);
    const wav = encodeWav(odd, 16000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(40, true)).toBe(2);
    expect(view.getUint32(4, true)).toBe(36 + 2);
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + 2);
  });

  test('the rate is carried, not assumed', () => {
    const wav = encodeWav(pcm, 48000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint32(24, true)).toBe(48000);
    expect(view.getUint32(28, true)).toBe(96000);
  });
});
