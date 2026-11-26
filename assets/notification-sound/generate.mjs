#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Regenerate the two chimes the NATIVE notifications play.
 *
 * - `kabmo_notification.wav` — a run finished (or failed). The climbing two-tone
 *   sine chime the console plays for a completion.
 * - `kabmo_attention.wav` — the agent is blocked on you. The triangle wave
 *   stepping down, which is the console's "waiting for you" cue.
 *
 * The browser/PWA synthesizes both at playback time in
 * `src/client/hooks/ui/notification-sound.ts`. A system notification cannot run
 * Web Audio: Android plays a channel's sound resource, iOS/macOS an
 * `UNNotificationSound`, and the freedesktop daemon a `sound-file`. Those need
 * files, so the envelopes are rendered once and committed.
 *
 * ## Why the numbers are copied instead of imported
 *
 * The synthesizer is TypeScript in the client bundle and this is a build-time
 * script; there is no shared module without dragging the client's `@/` imports
 * into it. The numbers below are therefore a second statement of the envelope,
 * and the two files name each other: change one, change both, and re-run this
 * script (`bun assets/notification-sound/generate.mjs`).
 *
 * Output: 44.1 kHz, 16-bit mono PCM. WAV because every one of those consumers
 * reads it with no transcoder, and Android's resource names only allow
 * `[a-z0-9_]`, which is why the files are named for a resource.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_RATE = 44_100;

/**
 * The completion chime: two sines, each with a linear attack and a geometric
 * decay. `gainSilence` is where `exponentialRampToValueAtTime(0.0001, …)` ends.
 */
const NOTIFICATION = {
  wave: 'sine',
  duration: 0.5,
  tones: [
    {
      start: 0,
      stop: 0.32,
      frequencyFrom: 587.33,
      frequencyTo: 880,
      frequencyRampEnd: 0.1,
      gainPeak: 0.14,
      gainAttackEnd: 0.02,
      gainSilence: 0.32,
    },
    {
      start: 0.06,
      stop: 0.42,
      frequencyFrom: 880,
      frequencyTo: 1174.66,
      frequencyRampEnd: 0.18,
      gainPeak: 0.1,
      gainAttackEnd: 0.08,
      gainSilence: 0.42,
    },
  ],
};

/**
 * The "waiting for you" cue: triangles at a fixed pitch, the second one lower
 * than the first. Its envelope is shorter at the attack and flat in pitch, which
 * is what makes it read as a different sound and not a quieter chime.
 */
const ATTENTION = {
  wave: 'triangle',
  duration: 0.7,
  tones: [
    { start: 0, stop: 0.18, frequencyFrom: 880, frequencyTo: 880, frequencyRampEnd: 0.0001, gainPeak: 0.11, gainAttackEnd: 0.015, gainSilence: 0.18 },
    { start: 0.16, stop: 0.62, frequencyFrom: 659.25, frequencyTo: 659.25, frequencyRampEnd: 0.0001, gainPeak: 0.13, gainAttackEnd: 0.175, gainSilence: 0.62 },
  ],
};

/** The oscillator frequency at `t` seconds, or 0 outside the tone's window. */
function frequencyAt(t, tone) {
  if (t < tone.start || t > tone.stop) return 0;
  const local = t - tone.start;
  const rampEnd = Math.max(tone.frequencyRampEnd - tone.start, 1e-9);
  const ramp = Math.min(local / rampEnd, 1);
  return tone.frequencyFrom * Math.pow(tone.frequencyTo / tone.frequencyFrom, ramp);
}

/** The gain at `t`, reproducing `linearRamp` then `exponentialRamp`. */
function gainAt(t, tone) {
  if (t < tone.start || t > tone.gainSilence) return 0;
  const local = t - tone.start;
  const attackEnd = tone.gainAttackEnd - tone.start;
  if (local <= attackEnd) return (tone.gainPeak * local) / attackEnd;
  const decay = (local - attackEnd) / (tone.gainSilence - tone.start - attackEnd);
  return tone.gainPeak * Math.pow(0.0001 / tone.gainPeak, decay);
}

/** A triangle in phase space: Web Audio's `triangle` never leaves [-1, 1]. */
function waveValue(wave, phase) {
  const wrapped = phase / (2 * Math.PI);
  if (wave === 'triangle') return 4 * Math.abs(wrapped - Math.floor(wrapped + 0.5)) - 1;
  return Math.sin(phase);
}

function render(spec) {
  const frames = Math.floor(spec.duration * SAMPLE_RATE);
  const samples = new Float64Array(frames);
  const phases = spec.tones.map(() => 0);

  for (let index = 0; index < frames; index += 1) {
    const t = index / SAMPLE_RATE;
    let mixed = 0;
    spec.tones.forEach((tone, at) => {
      const frequency = frequencyAt(t, tone);
      if (frequency === 0) return;
      phases[at] += (2 * Math.PI * frequency) / SAMPLE_RATE;
      mixed += waveValue(spec.wave, phases[at]) * gainAt(t, tone);
    });
    samples[index] = mixed;
  }
  return samples;
}

/**
 * Scaling.
 *
 * The raw envelopes peak between -17 and -14 dBFS — right for a Web Audio cue
 * mixed against nothing, inaudible as a system banner sitting under the OS's own
 * notification volume. Each file is scaled once to a peak of 0.75 (-2.5 dBFS).
 * One linear factor per file: the balance between the tones, and therefore the
 * sound's identity, is untouched.
 */
function encode(samples) {
  const peak = samples.reduce((highest, value) => Math.max(highest, Math.abs(value)), 0);
  const scale = peak > 0 ? 0.75 / peak : 1;
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((value, index) => {
    const clamped = Math.max(-1, Math.min(1, value * scale));
    data.writeInt16LE(Math.round(clamped * 32767), index * 2);
  });

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

for (const [name, spec] of [
  ['kabmo_notification.wav', NOTIFICATION],
  ['kabmo_attention.wav', ATTENTION],
]) {
  const target = join(HERE, name);
  writeFileSync(target, encode(render(spec)));
  console.log(`wrote ${name} (${(spec.duration * 1000).toFixed(0)} ms, ${SAMPLE_RATE} Hz mono)`);
}
