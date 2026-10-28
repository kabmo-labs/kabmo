/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Bounded protocol-v2 framing for OMP's NDJSON RPC transport.
 *
 * Faithful port of omp-web/lib/omp/rpc-frame.ts. Logical RPC frames are
 * carried as single JSONL lines when small; frames larger than the transport
 * limit are split into `rpc_chunk` sequences (base64 payloads) and
 * reassembled on the receiving side.
 */

import { isRecord } from '@/shared/lib/util/guards';

export const MAX_RPC_FRAME_BYTES = 1024 * 1024;
export const MAX_RPC_REASSEMBLED_BYTES = 64 * 1024 * 1024;
const RPC_CHUNK_PAYLOAD_BYTES = 256 * 1024;

export type RpcProtocolVersion = 1 | 2;
export type RpcFrameRecord = { type: string; [key: string]: unknown };

interface PendingChunks {
  chunkId: string;
  count: number;
  byteLength: number;
  nextIndex: number;
  chunks: Uint8Array[];
  receivedBytes: number;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * One encoder for every length check on this path.
 *
 * `encode()` allocates a throwaway array just to read `.byteLength`, and this
 * runs once per frame written to the child's stdin — every `message_update`,
 * every steer, every tool result. Hoisting it measured 17.2 ms → 8.6 ms per
 * 200k checks. A hoisted encoder rather than `Buffer.byteLength` because this
 * module is in `src/shared/` and is therefore browser-safe: `Buffer` is not.
 */
const utf8 = new TextEncoder();
/** Strict decoder for reassembled chunk payloads — a truncated sequence is an error. */
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

function utf8ByteLength(value: string): number {
  return utf8.encode(value).byteLength;
}

function lineByteLength(value: string): number {
  return utf8ByteLength(value) + 1;
}

/** Strict base64 decode (canonical padding + round-trip equality). */
function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) throw new Error('invalid RPC chunk data');
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(value, { lastChunkHandling: 'strict' });
  } catch {
    throw new Error('invalid RPC chunk data');
  }
  if (bytes.toBase64() !== value) throw new Error('invalid RPC chunk data');
  return bytes;
}

function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const merged = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

/** Decodes complete logical frames from parsed JSONL records. */
export class RpcFrameDecoder {
  private pending: PendingChunks | undefined;

  push(value: unknown): RpcFrameRecord | undefined {
    if (!isRecord(value) || value.type !== 'rpc_chunk') {
      if (this.pending) throw new Error('RPC chunk sequence interrupted');
      if (!isRecord(value) || typeof value.type !== 'string') throw new Error('RPC frame must be an object');
      return value as RpcFrameRecord;
    }
    const { chunkId, index, count, byteLength } = value;
    if (
      typeof chunkId !== 'string' || chunkId.length === 0 || chunkId.length > 128 ||
      !isSafeInteger(index) || !isSafeInteger(count) || !isSafeInteger(byteLength) ||
      index < 0 || count < 2 || count > Math.ceil(MAX_RPC_REASSEMBLED_BYTES / RPC_CHUNK_PAYLOAD_BYTES) ||
      index >= count || byteLength < MAX_RPC_FRAME_BYTES || byteLength > MAX_RPC_REASSEMBLED_BYTES
    ) throw new Error('invalid RPC chunk metadata');

    const bytes = decodeBase64(value.data);
    if (bytes.byteLength > RPC_CHUNK_PAYLOAD_BYTES) throw new Error('RPC chunk payload exceeds the transport limit');
    if (!this.pending) {
      if (index !== 0) throw new Error('RPC chunk sequence must start at index 0');
      this.pending = { chunkId, count, byteLength, nextIndex: 0, chunks: [], receivedBytes: 0 };
    }
    const pending = this.pending!;
    if (pending.chunkId !== chunkId || pending.count !== count || pending.byteLength !== byteLength || pending.nextIndex !== index) {
      throw new Error('RPC chunk sequence mismatch');
    }
    pending.chunks.push(bytes);
    pending.receivedBytes += bytes.byteLength;
    pending.nextIndex++;
    if (pending.receivedBytes > pending.byteLength) throw new Error('RPC chunk sequence exceeds declared length');
    if (pending.nextIndex < pending.count) return undefined;
    if (pending.receivedBytes !== pending.byteLength) throw new Error('RPC chunk sequence length mismatch');

    this.pending = undefined;
    const json = fatalUtf8.decode(concatChunks(pending.chunks, pending.byteLength));
    const frame: unknown = JSON.parse(json);
    if (!isRecord(frame) || typeof frame.type !== 'string') throw new Error('RPC frame must be an object');
    return frame as RpcFrameRecord;
  }
}

/** Physical JSONL records for a logical RPC frame at the selected protocol. */
export function encodeRpcFrames(frame: RpcFrameRecord, protocolVersion: RpcProtocolVersion, chunkId: string): string[] {
  const json = JSON.stringify(frame);
  // Encode once and keep the bytes: the length check needs them either way, and
  // the oversized path below needs them again. Previously this encoded the
  // whole frame to measure it, discarded that array, then encoded it a second
  // time to slice it.
  const bytes = utf8.encode(json);
  if (bytes.byteLength + 1 <= MAX_RPC_FRAME_BYTES) return [`${json}\n`];
  if (protocolVersion === 1) throw new Error('RPC frame exceeds the v1 transport limit');
  if (bytes.byteLength > MAX_RPC_REASSEMBLED_BYTES) throw new Error('RPC frame exceeds the v2 reassembly limit');
  const count = Math.ceil(bytes.byteLength / RPC_CHUNK_PAYLOAD_BYTES);
  const lines: string[] = [];
  for (let index = 0; index < count; index++) {
    const chunk = {
      type: 'rpc_chunk', chunkId, index, count, byteLength: bytes.byteLength,
      data: bytes.subarray(index * RPC_CHUNK_PAYLOAD_BYTES, (index + 1) * RPC_CHUNK_PAYLOAD_BYTES).toBase64(),
    };
    const line = JSON.stringify(chunk);
    if (lineByteLength(line) > MAX_RPC_FRAME_BYTES) throw new Error('RPC chunk exceeds the transport limit');
    lines.push(`${line}\n`);
  }
  return lines;
}
