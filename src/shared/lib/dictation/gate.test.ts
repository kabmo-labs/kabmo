/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two gates that decide whether an utterance is sent at all.
 *
 * Both exist because of the same failure: a ~100 ms tap is the classic input for
 * a Whisper hallucination ("Thank you." / "Terima kasih."), which the composer
 * then writes into the draft as if the user had said it. The thresholds are the
 * product decision; the arithmetic is what this file pins, because an off-by-two
 * in the byte→millisecond conversion would silently accept taps again.
 */

import { describe, expect, test } from 'bun:test';
import {
  DICTATION_MIN_MS,
  DICTATION_SILENCE_FLOOR,
  isSilent,
  utteranceMs,
} from '@/shared/lib/dictation/gate';

/** PCM16LE mono samples from normalised floats. */
function pcm16(samples: readonly number[]): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  samples.forEach((sample, index) => {
    view.setInt16(index * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true);
  });
  return out;
}

/** A sine wave at `amplitude` — the shape a real utterance has, scaled. */
function tone(amplitude: number, count = 1600): Uint8Array {
  return pcm16(Array.from({ length: count }, (_, i) => amplitude * Math.sin((2 * Math.PI * 220 * i) / 16000)));
}

describe('utteranceMs', () => {
  test('16000 samples of PCM16 is one second', () => {
    expect(utteranceMs(32_000)).toBe(1000);
  });

  test('a tap is under the minimum', () => {
    // 100 ms — the length that makes a recognizer invent a sentence.
    expect(utteranceMs(3200)).toBeLessThan(DICTATION_MIN_MS);
  });

  test('an odd byte length still measures the whole samples', () => {
    expect(utteranceMs(32_001)).toBe(1000);
  });
});

describe('isSilent', () => {
  test('an empty buffer is silent', () => {
    expect(isSilent(new Uint8Array(0))).toBe(true);
  });

  test('digital silence is silent', () => {
    expect(isSilent(new Uint8Array(6400))).toBe(true);
  });

  test('a room-noise floor is silent', () => {
    // Measured on a silent room with the built-in mic: RMS ~0.0009.
    expect(isSilent(tone(0.0009))).toBe(true);
  });

  test('speech is not silent', () => {
    expect(isSilent(tone(0.2))).toBe(false);
  });

  test('the floor is the boundary, not an arbitrary guess', () => {
    expect(isSilent(tone(DICTATION_SILENCE_FLOOR * 0.5))).toBe(true);
    expect(isSilent(tone(DICTATION_SILENCE_FLOOR * 3))).toBe(false);
  });

  test('an unaligned view is read, not assumed aligned', () => {
    const bytes = tone(0.2);
    const shifted = new Uint8Array(bytes.byteLength + 1);
    shifted.set(bytes, 1);
    // byteOffset 1 cannot back an Int16Array; the copy path must still work.
    expect(isSilent(shifted.subarray(1))).toBe(false);
  });
});
