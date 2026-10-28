/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bounded NDJSON framing for the omp RPC transport.
 *
 * Framing bugs are silent data corruption: a frame read as two lines, or a
 * chunk sequence reassembled with the wrong bytes, reaches the session wrapper
 * as a plausible-looking but wrong event. These tests pin the length boundary
 * that selects single-line vs chunked encoding, the exact chunk sequence
 * bookkeeping (ordering, count, declared byte length), the strict base64 and
 * UTF-8 decoding, and the failure modes that must reject rather than guess.
 */

import { describe, expect, test } from 'bun:test';

import {
  MAX_RPC_FRAME_BYTES,
  MAX_RPC_REASSEMBLED_BYTES,
  RpcFrameDecoder,
  encodeRpcFrames,
  type RpcFrameRecord,
} from '@/shared/lib/omp/rpc/frame';

/** A frame whose JSON is exactly `byteLength` bytes (ASCII pad ⇒ bytes = chars). */
function frameOfBytes(byteLength: number): RpcFrameRecord {
  const overhead = JSON.stringify({ type: 'x', pad: '' }).length;
  return { type: 'x', pad: 'A'.repeat(byteLength - overhead) };
}

/** Chunk record with the defaults every case overrides one field of — keeping
 *  them in lockstep is what makes a single-field override meaningful. */
function chunk(overrides: Record<string, unknown>): Record<string, unknown> {
  return { type: 'rpc_chunk', chunkId: 'c1', index: 0, count: 2, byteLength: MAX_RPC_FRAME_BYTES, data: 'AAAA', ...overrides };
}

describe('transport limits', () => {
  test('the frame and reassembly ceilings are the documented values', () => {
    expect(MAX_RPC_FRAME_BYTES).toBe(1024 * 1024);
    expect(MAX_RPC_REASSEMBLED_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe('encodeRpcFrames — single-line path', () => {
  test('a small frame is one JSON line terminated by a newline', () => {
    const frame = { type: 'ready', n: 1 };
    expect(encodeRpcFrames(frame, 1, 'chunk')).toEqual([`${JSON.stringify(frame)}\n`]);
  });

  test('the exact boundary is a frame whose JSON is MAX-1 bytes (plus newline = MAX)', () => {
    const frame = frameOfBytes(MAX_RPC_FRAME_BYTES - 1);
    const lines = encodeRpcFrames(frame, 1, 'chunk');
    expect(lines.length).toBe(1);
    expect(lines[0].length).toBe(MAX_RPC_FRAME_BYTES);
  });

  test('one byte over the boundary stops being a single line', () => {
    const frame = frameOfBytes(MAX_RPC_FRAME_BYTES);
    // v1 has no fallback: an oversized frame is a hard error.
    expect(() => encodeRpcFrames(frame, 1, 'chunk')).toThrow('RPC frame exceeds the v1 transport limit');
  });
});

describe('encodeRpcFrames — v2 chunking', () => {
  test('an oversized frame becomes a contiguous chunk sequence that round-trips', () => {
    const frame = frameOfBytes(MAX_RPC_FRAME_BYTES + 5_000);
    const lines = encodeRpcFrames(frame, 2, 'chunk-1');
    const payload = new TextEncoder().encode(JSON.stringify(frame));
    const expectedCount = Math.ceil(payload.byteLength / (256 * 1024));
    expect(lines.length).toBe(expectedCount);

    const decoder = new RpcFrameDecoder();
    const records = lines.map((line) => JSON.parse(line));
    for (let i = 0; i < records.length; i++) {
      expect(records[i].type).toBe('rpc_chunk');
      expect(records[i].chunkId).toBe('chunk-1');
      expect(records[i].index).toBe(i);
      expect(records[i].count).toBe(expectedCount);
      expect(records[i].byteLength).toBe(payload.byteLength);
      expect(lines[i].endsWith('\n')).toBe(true);
      // Every push before the last must yield nothing — the decoder is holding
      // an incomplete logical frame.
      const out = decoder.push(records[i]);
      if (i < records.length - 1) expect(out).toBeUndefined();
      else expect(out).toEqual(frame);
    }
  });

  test('a frame over the reassembly ceiling is refused before chunking', () => {
    const frame = { type: 'x', pad: 'A'.repeat(MAX_RPC_REASSEMBLED_BYTES) };
    expect(() => encodeRpcFrames(frame, 2, 'chunk')).toThrow('RPC frame exceeds the v2 reassembly limit');
  });
});

describe('RpcFrameDecoder — plain frames', () => {
  test('a record with a string type passes through unchanged', () => {
    const decoder = new RpcFrameDecoder();
    const frame = { type: 'message_update', text: 'hi' };
    expect(decoder.push(frame)).toBe(frame);
  });

  test('an unknown type is still a valid frame', () => {
    const decoder = new RpcFrameDecoder();
    expect(decoder.push({ type: 'something_new' })).toEqual({ type: 'something_new' });
  });

  test('non-records and typeless records are rejected', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(null)).toThrow('RPC frame must be an object');
    expect(() => decoder.push([1, 2])).toThrow('RPC frame must be an object');
    expect(() => decoder.push('nope')).toThrow('RPC frame must be an object');
    expect(() => decoder.push({ noType: 1 })).toThrow('RPC frame must be an object');
  });
});

describe('RpcFrameDecoder — chunk metadata validation', () => {
  test('a sequence that does not start at index 0 is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ index: 1 }))).toThrow('RPC chunk sequence must start at index 0');
  });

  test('a single-chunk sequence is impossible: count must be >= 2', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ count: 1 }))).toThrow('invalid RPC chunk metadata');
  });

  test('an index at or past the count is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ index: 2, count: 2 }))).toThrow('invalid RPC chunk metadata');
  });

  test('a declared byte length below the frame limit is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ byteLength: MAX_RPC_FRAME_BYTES - 1 }))).toThrow('invalid RPC chunk metadata');
  });

  test('missing/empty/oversized chunk ids and non-integer numbers are refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ chunkId: '' }))).toThrow('invalid RPC chunk metadata');
    expect(() => decoder.push(chunk({ chunkId: 'x'.repeat(129) }))).toThrow('invalid RPC chunk metadata');
    expect(() => decoder.push(chunk({ chunkId: 7 }))).toThrow('invalid RPC chunk metadata');
    expect(() => decoder.push(chunk({ index: 0.5 }))).toThrow('invalid RPC chunk metadata');
    expect(() => decoder.push(chunk({ byteLength: Number.MAX_SAFE_INTEGER + 1 }))).toThrow('invalid RPC chunk metadata');
  });

  test('non-canonical base64 is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ data: '' }))).toThrow('invalid RPC chunk data');
    expect(() => decoder.push(chunk({ data: 'AAAA=' }))).toThrow('invalid RPC chunk data');
    expect(() => decoder.push(chunk({ data: '!!!!' }))).toThrow('invalid RPC chunk data');
    expect(() => decoder.push(chunk({ data: 42 }))).toThrow('invalid RPC chunk data');
  });

  test('a chunk payload larger than the transport slice is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(() => decoder.push(chunk({ data: new Uint8Array(256 * 1024 + 1).fill(65).toBase64() }))).toThrow(
      'RPC chunk payload exceeds the transport limit',
    );
  });
});

describe('RpcFrameDecoder — sequence bookkeeping', () => {
  test('a plain frame arriving mid-sequence is an interruption', () => {
    const decoder = new RpcFrameDecoder();
    expect(decoder.push(chunk({ data: new Uint8Array(1024).fill(65).toBase64() }))).toBeUndefined();
    expect(() => decoder.push({ type: 'ready' })).toThrow('RPC chunk sequence interrupted');
  });

  test('a mismatched chunk id or count is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(decoder.push(chunk({ data: new Uint8Array(1024).fill(65).toBase64() }))).toBeUndefined();
    expect(() => decoder.push(chunk({ index: 1, chunkId: 'other', data: new Uint8Array(1024).fill(65).toBase64() }))).toThrow(
      'RPC chunk sequence mismatch',
    );
  });

  test('a skipped index is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(decoder.push(chunk({ count: 3, data: new Uint8Array(1024).fill(65).toBase64() }))).toBeUndefined();
    expect(() => decoder.push(chunk({ count: 3, index: 2, data: new Uint8Array(1024).fill(65).toBase64() }))).toThrow(
      'RPC chunk sequence mismatch',
    );
  });

  test('a completed sequence whose bytes do not match the declared length is refused', () => {
    const decoder = new RpcFrameDecoder();
    expect(decoder.push(chunk({ data: new Uint8Array(256 * 1024).fill(65).toBase64() }))).toBeUndefined();
    expect(() => decoder.push(chunk({ index: 1, data: new Uint8Array(256 * 1024).fill(65).toBase64() }))).toThrow(
      'RPC chunk sequence length mismatch',
    );
  });

  test('bytes past the declared length are refused immediately', () => {
    const decoder = new RpcFrameDecoder();
    for (let index = 0; index < 4; index++) {
      expect(decoder.push(chunk({ count: 5, index, data: new Uint8Array(256 * 1024).fill(65).toBase64() }))).toBeUndefined();
    }
    expect(() => decoder.push(chunk({ count: 5, index: 4, data: new Uint8Array(256 * 1024).fill(65).toBase64() }))).toThrow(
      'RPC chunk sequence exceeds declared length',
    );
  });

  test('a reassembled payload that is not a frame record is refused', () => {
    const decoder = new RpcFrameDecoder();
    const padded = new Uint8Array(MAX_RPC_FRAME_BYTES).fill(32);
    padded.set(new TextEncoder().encode('[1,2,3]'), 0);
    // Declared length must be >= the frame limit and equal the real byte count;
    // the payload is split into 256 KiB slices, the largest a chunk may carry.
    const base = { chunkId: 'c', count: 4, byteLength: padded.byteLength };
    for (let index = 0; index < 3; index++) {
      const slice = padded.subarray(index * 256 * 1024, (index + 1) * 256 * 1024).toBase64();
      expect(decoder.push({ type: 'rpc_chunk', ...base, index, data: slice })).toBeUndefined();
    }
    const last = padded.subarray(3 * 256 * 1024).toBase64();
    expect(() => decoder.push({ type: 'rpc_chunk', ...base, index: 3, data: last })).toThrow('RPC frame must be an object');
  });

  test('a reassembled payload with a truncated UTF-8 sequence is refused', () => {
    const decoder = new RpcFrameDecoder();
    const padded = new Uint8Array(MAX_RPC_FRAME_BYTES).fill(32);
    // 0xE2 0x82 is the start of a 3-byte sequence with its tail missing.
    padded.set([0xe2, 0x82], 0);
    const base = { chunkId: 'c', count: 4, byteLength: padded.byteLength };
    for (let index = 0; index < 3; index++) {
      const slice = padded.subarray(index * 256 * 1024, (index + 1) * 256 * 1024).toBase64();
      expect(decoder.push({ type: 'rpc_chunk', ...base, index, data: slice })).toBeUndefined();
    }
    const last = padded.subarray(3 * 256 * 1024).toBase64();
    // The bytes never reach JSON.parse: the strict decoder rejects them first.
    expect(() => decoder.push({ type: 'rpc_chunk', ...base, index: 3, data: last })).toThrow();
  });

  test('a fresh sequence can start after a completed one', () => {
    const decoder = new RpcFrameDecoder();
    const frame = frameOfBytes(MAX_RPC_FRAME_BYTES + 1_000);
    for (const line of encodeRpcFrames(frame, 2, 'a')) decoder.push(JSON.parse(line));
    expect(decoder.push({ type: 'ready' })).toEqual({ type: 'ready' });
  });
});
