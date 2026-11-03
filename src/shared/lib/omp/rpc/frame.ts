/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * NDJSON framing for OMP's RPC transport, in both directions.
 *
 * The two directions are NOT symmetric, and treating them as if they were is
 * what silently dropped every prompt carrying a real image:
 *
 * - **omp → Kabmo** frames are bounded at `MAX_RPC_FRAME_BYTES`; under protocol
 *   v2 (`negotiate_protocol`) a larger event arrives as an `rpc_chunk`
 *   sequence, which `RpcFrameDecoder` reassembles.
 * - **Kabmo → omp** frames must go out as ONE line, however long. omp
 *   advertises protocol v2 and acks the negotiation, but its rpc-ui stdin loop
 *   has no `rpc_chunk` handler: measured against omp 18.14.0 and 18.16.0, every
 *   chunk came back `{success:false,error:"Unknown command: rpc_chunk"}` and the
 *   prompt was never dispatched — 6 records for a 1.3 MB image, no `agent_start`,
 *   no ack, and Kabmo reset the session after `PROMPT_ACK_TIMEOUT_MS`. A single
 *   30 MB line for the same image is accepted and acked in ~26 s, so the limit
 *   here is a guard against unbounded writes, not a transport limit.
 *
 * Hence: one encoder (`encodeRpcFrameLine`) that never chunks, and a decoder
 * that still understands chunks.
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
 * The byte-length probe for an outbound frame.
 *
 * A hoisted encoder rather than `Buffer.byteLength` because this module is in
 * `src/shared/` and is therefore browser-safe: `Buffer` is not.
 */
const utf8 = new TextEncoder();
/** Strict decoder for reassembled chunk payloads — a truncated sequence is an error. */
const fatalUtf8 = new TextDecoder('utf-8', { fatal: true });

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

/**
 * Largest logical frame Kabmo will WRITE to an omp child, as one JSONL line.
 *
 * omp reads its command loop line by line, so this is only a guard against an
 * unbounded write (a runaway attachment, a corrupted payload) — not a
 * transport limit. Measured: a 30 MB prompt line is accepted and acked in
 * ~26 s, while the same payload split into `rpc_chunk`s is rejected outright.
 * The ceiling matches the reassembly limit omp advertises for the other
 * direction (`maxReassembledFrameBytes`), so neither side can claim a payload
 * the other refuses.
 */
export const MAX_OUTBOUND_FRAME_BYTES = MAX_RPC_REASSEMBLED_BYTES;

/**
 * One physical JSONL line for a logical RPC frame.
 *
 * NEVER chunked, whatever `negotiate_protocol` answered: omp's rpc-ui stdin
 * loop answers `Unknown command: rpc_chunk` to every chunk record (verified on
 * 18.14.0 and 18.16.0) and the command is then never dispatched — a prompt
 * carrying a >1 MiB image sat unacked until the ack timeout reset the session.
 * The refusal is thrown at the caller instead, so a payload omp would drop is
 * reported rather than silently lost.
 */
export function encodeRpcFrameLine(frame: RpcFrameRecord): string {
  const json = JSON.stringify(frame);
  const bytes = utf8.encode(json).byteLength + 1;
  if (bytes > MAX_OUTBOUND_FRAME_BYTES) {
    throw new Error(`RPC frame of ${bytes} bytes exceeds the ${MAX_OUTBOUND_FRAME_BYTES}-byte outbound limit`);
  }
  return `${json}\n`;
}
