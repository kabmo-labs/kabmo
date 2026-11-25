/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Float samples → a mono 16-bit PCM WAV, in memory.
 *
 * In memory because the player is handed bytes over HTTP and a temp file per
 * sentence would add a write, a read and a cleanup to a path that already takes
 * a second. The container is written by hand rather than through the addon's
 * `writeWave`, so the same function serves any engine that hands back samples.
 */

const HEADER_BYTES = 44;

/** Mono 16-bit PCM WAV. Samples outside −1..1 are clamped, not wrapped. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new Uint8Array(HEADER_BYTES + dataBytes);
  const view = new DataView(buffer.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(HEADER_BYTES + i * 2, Math.round(clamped * 32_767), true);
  }
  return buffer;
}
