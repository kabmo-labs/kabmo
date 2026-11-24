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

/** The sentence for a capture that produced no samples at all. */
export const DICTATION_NO_AUDIO =
  'The microphone sent no audio — check the input device in Settings → Dictation.';

/**
 * The buffer as signed 16-bit samples, copying only when the view is unaligned.
 */
function pcm16Samples(pcm16: Uint8Array): Int16Array {
  const sampleCount = pcm16.byteLength >> 1;
  if (pcm16.byteOffset % 2 === 0) return new Int16Array(pcm16.buffer, pcm16.byteOffset, sampleCount);
  return new Int16Array(pcm16.slice(0, sampleCount * 2).buffer, 0, sampleCount);
}

/**
 * True when EVERY sample is exactly zero — a capture that delivered nothing.
 *
 * This is not the same failure as a quiet room: a working microphone always
 * carries some dither (measured ~0.0009 RMS with the built-in mic in silence),
 * so bit-exact zeros mean the audio never reached the page. It is what a WebKit
 * capture looks like after `BaseAudioCaptureUnit::captureFailed` ends the track,
 * and reporting it as "No speech was detected" blames the speaker for a dead
 * microphone. Checked before `isSilent`, because it is the narrower condition.
 */
export function isDeadCapture(pcm16: Uint8Array): boolean {
  const samples = pcm16Samples(pcm16);
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] !== 0) return false;
  }
  return true;
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
  const samples = pcm16Samples(pcm16);
  let sum = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = samples[i] / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / sampleCount) < floor;
}
