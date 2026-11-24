/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A WAV container for the captured PCM16.
 *
 * Every hosted engine documents `wav` among its accepted uploads, while their
 * Opus/WebM support differs — so one 44-byte header covers all of them and the
 * browser keeps sending the raw PCM16 it already produces. The header is
 * written by hand because there is no encoder dependency in this project and a
 * 16 kHz mono PCM header is 44 fixed bytes.
 */

export const WAV_HEADER_BYTES = 44;

/**
 * Wrap PCM16LE mono samples in a RIFF/WAVE container.
 *
 * An odd byte length is truncated to whole samples: a trailing byte cannot be
 * described by `byteRate`/`blockAlign`, and every decoder reads the last sample
 * from the data chunk.
 */
export function encodeWav(pcm16: Uint8Array, sampleRate = 16000): Uint8Array {
  const dataBytes = pcm16.byteLength - (pcm16.byteLength % 2);
  const out = new Uint8Array(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i);
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate: rate * channels * 2
  view.setUint16(32, 2, true); // blockAlign: channels * 2
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  out.set(pcm16.subarray(0, dataBytes), WAV_HEADER_BYTES);
  return out;
}
