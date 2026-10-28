/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Audio conversion for dictation.
 *
 * Three formats meet in this feature, and mixing them up is the failure mode
 * that costs an afternoon:
 * - **Float32, ±1** — what omp's STT worker takes. It hands the array straight
 *   to the transformers.js feature extractor, which rejects anything else
 *   ("WhisperFeatureExtractor expects input to be a Float32Array ... but got
 *   Uint8Array"), and treats a STRING as an encoded file to decode — which
 *   needs `AudioContext` and fails in the worker ("Unable to load audio from
 *   path/URL since `AudioContext` is not available in your environment").
 *   Verified against omp 18.4.10: only a Float32Array transcribes.
 * - **PCM16LE** — the wire format, half the bytes of Float32.
 * - **Float32 at the device rate** — what `AudioContext` hands the capture
 *   callback, usually 48 kHz, so it needs resampling on the way out.
 */

/** Normalized Float32 samples from mono PCM16LE bytes. */
export function pcm16ToFloat32(bytes: Uint8Array): Float32Array {
  // An odd byteOffset cannot back an Int16Array; copy when the view is unaligned.
  const aligned =
    bytes.byteOffset % 2 === 0
      ? new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength >> 1)
      : new Int16Array(bytes.slice().buffer, 0, bytes.byteLength >> 1);
  const out = new Float32Array(aligned.length);
  for (let i = 0; i < aligned.length; i++) {
    out[i] = aligned[i] / 32768;
  }
  return out;
}

/** Mono PCM16LE from Float32 samples, resampled to `outputRate` when needed. */
export function float32ToPcm16(
  input: Float32Array,
  inputRate: number,
  outputRate: number,
): Int16Array {
  const ratio = inputRate === outputRate ? 1 : inputRate / outputRate;
  const outLength = ratio === 1 ? input.length : Math.round(input.length / ratio);
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    let sample: number;
    if (ratio === 1) {
      sample = input[i];
    } else {
      // Linear interpolation. The STT front-end re-frames to its own mel bins,
      // so a sharper kernel buys nothing audible.
      const pos = i * ratio;
      const lo = Math.min(Math.floor(pos), input.length - 1);
      const hi = Math.min(lo + 1, input.length - 1);
      sample = input[lo] + (input[hi] - input[lo]) * (pos - lo);
    }
    const clamped = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

/** Concatenate capture chunks into one contiguous sample buffer. */
export function concatSamples(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
