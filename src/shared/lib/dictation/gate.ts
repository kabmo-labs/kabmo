/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Utterance limits: how short is "a tap", how long is "forgot to stop", and
 * when is a buffer silence rather than speech.
 *
 * A ~100 ms buffer is the classic Whisper hallucination input: the model has no
 * speech to condition on and emits "Thank you." / "Terima kasih." from its
 * training prior, which the composer then writes into the draft. Refusing short
 * and silent buffers locally is cheaper and more honest than reporting whatever
 * the engine invents.
 */

import { DICTATION_SAMPLE_RATE } from '@/shared/lib/dictation/protocol';

export const DICTATION_MIN_MS = 300;
export const DICTATION_MAX_MS = 120_000;

/**
 * Root-mean-square floor in normalised units (~-50 dBFS).
 *
 * Below it the buffer is background noise, not speech. Measured on a silent
 * room recording (macOS built-in mic, 2 s): RMS ~0.0009; normal speech sits
 * two orders of magnitude above.
 */
export const DICTATION_SILENCE_FLOOR = 0.003;

/** Length of a PCM16LE mono buffer, in milliseconds. */
export function utteranceMs(pcm16Bytes: number, sampleRate = DICTATION_SAMPLE_RATE): number {
  // Whole samples only: a trailing byte cannot be decoded, so counting it would
  // report a length the recognizer will not hear.
  return (Math.floor(pcm16Bytes / 2) / sampleRate) * 1000;
}

/**
 * True when the buffer holds no speech above `floor`.
 *
 * Reads PCM16LE directly, so the server can reject an utterance before it
 * decodes or uploads anything. An unaligned view is copied, never assumed.
 */
export function isSilent(pcm16: Uint8Array, floor = DICTATION_SILENCE_FLOOR): boolean {
  const sampleCount = pcm16.byteLength >> 1;
  if (sampleCount === 0) return true;
  const samples =
    pcm16.byteOffset % 2 === 0
      ? new Int16Array(pcm16.buffer, pcm16.byteOffset, sampleCount)
      : new Int16Array(pcm16.slice(0, sampleCount * 2).buffer, 0, sampleCount);
  let sum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = samples[i] / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / sampleCount) < floor;
}
