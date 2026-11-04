#!/usr/bin/env bun
/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A scripted `omp` RPC child for the TRANSPORT questions `RpcProcess` owns.
 *
 * It exists because those questions cannot be asked of a real child: omp 18.16.0
 * never advertises ceilings other than its own, and it never emits a malformed
 * `rpc_chunk` sequence. Both are exactly what the reader must survive, so the
 * child says what the test needs it to say.
 *
 * `ready` advertises what these env vars name, defaulting to omp's own values:
 *   FAKE_OMP_READY_MAX_FRAME_BYTES          (default 1048576)
 *   FAKE_OMP_READY_MAX_REASSEMBLED_BYTES    (default 67108864)
 *
 * `bash` is the trigger: it writes `FAKE_OMP_CHUNK` BEFORE answering, which is
 * the only way to put a chunk record in front of the reader from inside the
 * protocol. Values:
 *   `valid-1mib`    — a complete 1 MiB sequence. Valid under the default 1 MiB
 *                     physical ceiling, invalid under an advertised 4 MiB one
 *                     (a frame that small is never chunked there).
 *   `bad-index`     — a chunk that does not start at index 0: a hard fault.
 * Anything else writes nothing.
 *
 * The source MUST stay constant: it is spawned as-is on every run.
 */

import { appendFileSync } from 'node:fs';

const encoder = new TextEncoder();
const write = (frame: unknown) => {
  process.stdout.write(encoder.encode(`${JSON.stringify(frame)}\n`));
};

const numberFromEnv = (name: string, fallback: number): number => {
  const raw = Bun.env[name];
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const ready = {
  type: 'ready',
  protocolVersion: 1,
  supportedProtocolVersions: [1, 2],
  maxFrameBytes: numberFromEnv('FAKE_OMP_READY_MAX_FRAME_BYTES', 1024 * 1024),
  maxReassembledFrameBytes: numberFromEnv('FAKE_OMP_READY_MAX_REASSEMBLED_BYTES', 64 * 1024 * 1024),
};

/**
 * A complete, VALID chunk sequence for a 1 MiB logical frame — 4 slices of the
 * 256 KiB a chunk may carry, and a byte length exactly at omp's default physical
 * ceiling (so `byteLength >= maxFrameBytes` holds there and fails under any
 * larger advertised ceiling).
 *
 * The demand is what makes the ceiling test meaningful: the SAME bytes are a
 * valid sequence under the default ceiling and a protocol fault under an
 * advertised 4 MiB one, because a frame that small is never chunked then.
 */
const CHUNK_BYTES = 1024 * 1024;
const CHUNK_SLICE = 256 * 1024;
const CHUNK_COUNT = CHUNK_BYTES / CHUNK_SLICE;

function validSequence(): Uint8Array[] {
  const head = '{"type":"noop","pad":"';
  const tail = '"}';
  const json = `${head}${'A'.repeat(CHUNK_BYTES - head.length - tail.length)}${tail}`;
  const bytes = new TextEncoder().encode(json);
  return Array.from({ length: CHUNK_COUNT }, (_, index) => bytes.subarray(index * CHUNK_SLICE, (index + 1) * CHUNK_SLICE));
}

function scriptedChunks(mode: string | undefined): Record<string, unknown>[] {
  if (mode === 'valid-1mib') {
    const slices = validSequence();
    return slices.map((slice, index) => ({
      type: 'rpc_chunk',
      chunkId: 'fake-1',
      index,
      count: CHUNK_COUNT,
      byteLength: CHUNK_BYTES,
      data: slice.toBase64(),
    }));
  }
  if (mode === 'bad-index') {
    return [{
      type: 'rpc_chunk',
      chunkId: 'fake-2',
      index: 5,
      count: CHUNK_COUNT,
      byteLength: CHUNK_BYTES,
      data: new Uint8Array(1024).fill(65).toBase64(),
    }];
  }
  return [];
}

const respond = (id: unknown, command: string, data: unknown) => {
  write({ type: 'response', id, command, success: true, data });
};

const state = {
  sessionId: 'fake-session',
  sessionFile: '/tmp/fake-session.jsonl',
  isStreaming: false,
  isSettled: true,
  isCompacting: false,
  autoCompactionEnabled: true,
  interruptMode: 'immediate',
  steeringMode: 'one-at-a-time',
  followUpMode: 'one-at-a-time',
  messageCount: 0,
};

write(ready);

const decoder = new TextDecoder();
let buffer = '';
const stdin = Bun.stdin.stream().getReader();

for (;;) {
  const { done, value } = await stdin.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  let newline = buffer.indexOf('\n');
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    newline = buffer.indexOf('\n');
    if (!line) continue;
    let frame: Record<string, unknown>;
    try {
      frame = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = frame.id;
    switch (frame.type) {
      case 'negotiate_protocol':
        respond(id, 'negotiate_protocol', { protocolVersion: 2 });
        break;
      case 'bash': {
        for (const chunk of scriptedChunks(Bun.env.FAKE_OMP_CHUNK)) write(chunk);
        respond(id, 'bash', { output: 'fake', exitCode: 0, cancelled: false, truncated: false, totalLines: 1, totalBytes: 4, outputLines: 1, outputBytes: 4 });
        break;
      }
      case 'prompt': {
        const log = Bun.env.FAKE_OMP_PROMPT_LOG;
        if (log) {
          try {
            appendFileSync(log, `${JSON.stringify({ id, type: frame.type })}\n`);
          } catch {}
        }
        respond(id, 'prompt', { agentInvoked: false });
        break;
      }
      default:
        respond(id, String(frame.type), state);
        break;
    }
  }
}
