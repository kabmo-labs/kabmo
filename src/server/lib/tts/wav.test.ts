/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { describe, expect, test } from 'bun:test';

import { encodeWavPcm16 } from '@/server/lib/tts/wav';

const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2]);
const wav = encodeWavPcm16(samples, 24_000);
const view = new DataView(wav.buffer);

describe('encodeWavPcm16', () => {
  test('states the container the player is promised', () => {
    const ascii = (offset: number, length: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + length));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(12, 4)).toBe('fmt ');
    expect(ascii(36, 4)).toBe('data');
    expect(wav.byteLength).toBe(44 + samples.length * 2);
    expect(view.getUint32(4, true)).toBe(wav.byteLength - 8);
    expect(view.getUint32(24, true)).toBe(24_000);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  test('clamps out-of-range samples instead of wrapping them', () => {
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(Math.round(0.5 * 32_767));
    expect(view.getInt16(48, true)).toBe(Math.round(-0.5 * 32_767));
    expect(view.getInt16(50, true)).toBe(32_767);
    expect(view.getInt16(52, true)).toBe(-32_767);
    expect(view.getInt16(54, true)).toBe(32_767);
  });
});
