/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local STT worker's lifecycle, against fake `omp` binaries.
 *
 * The reported bug: dictation from a phone answered `STT worker exited.` The
 * server the phone talks to was a Kabmo build from before the framed transport
 * existed, so it spawned the 19.x worker with 18.x Bun IPC and `stdin: "ignore"`
 * — and that worker SIGKILLs itself in ~35 ms (measured on omp 19.1.1). The
 * message described a crash where the truth was a version mismatch, and nothing
 * in it pointed at the server.
 *
 * Three contracts are pinned here, each of which a refactor could lose silently:
 *
 * 1. The framed transport works end to end — a `transcribe` frame carries the
 *    samples as the `$pcm` payload (not a JSON array) and its answer comes back.
 * 2. A worker that dies before answering is reported as the mismatch it is, not
 *    as `STT worker exited.`
 * 3. A worker that died earlier cannot tear down its replacement: its exit
 *    arrives after the new child is already serving, and the in-flight
 *    transcription must still succeed.
 *
 * The stub speaks the frame layout itself rather than importing the codec —
 * a test that reuses the encoder under test would pass even if the encoder
 * disagreed with omp.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { executableStub } from '@/test-support/executable-stub';
import { invalidateOmpCliCache } from '@kabmo-labs/kabmo-omp-cli';
import { removeDir } from '@/test-support/remove-dir';
import { recycleSttWorker, sttWorker } from '@/server/lib/dictation/omp-stt-worker';

/**
 * A worker that dies before it can answer anything: the stale-transport shape,
 * minus the 35 ms (the real one is SIGKILLed by its own stdin reader).
 */
const DEAD_WORKER = `process.exit(0);`;

/**
 * A worker that speaks the frames: ping, then transcribe.
 *
 * The transcription names the payload's byte length and the header field that
 * carried it, which is what proves the samples travelled as `$pcm` payload
 * rather than as a JSON array of numbers.
 */
const SPEAKING_WORKER = `
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function write(frame) {
  const body = encoder.encode(JSON.stringify(frame));
  const out = new Uint8Array(5 + body.length);
  new DataView(out.buffer).setUint32(0, 1 + body.length, true);
  out[4] = 0;
  out.set(body, 5);
  Bun.stdout.write(out);
}

function answer(header, payloadLength) {
  const kind = payloadLength === undefined ? 'header' : 'payload';
  write({
    type: 'transcription',
    id: header.id,
    text: kind === 'header' ? 'no-payload' : payloadLength + ':' + header.$pcm,
  });
}

let buffer = new Uint8Array(0);
const reader = Bun.stdin.stream().getReader();
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  const merged = new Uint8Array(buffer.length + value.length);
  merged.set(buffer);
  merged.set(value, buffer.length);
  buffer = merged;

  for (;;) {
    if (buffer.length < 4) break;
    const length = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).getUint32(0, true);
    if (buffer.length < 4 + length) break;
    const kind = buffer[4];
    const body = buffer.slice(5, 4 + length);
    buffer = buffer.slice(4 + length);

    if (kind === 0) {
      const header = JSON.parse(decoder.decode(body));
      if (header.type === 'ping') write({ type: 'pong', id: header.id });
      else answer(header, undefined);
      continue;
    }

    const headerLength = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true);
    const header = JSON.parse(decoder.decode(body.slice(4, 4 + headerLength)));
    answer(header, body.byteLength - 4 - headerLength);
  }
}
`;

const originalBin = Bun.env.KABMO_OMP_BIN;
let dir = '';

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-stt-worker-'));
  delete Bun.env.MOCK;
  recycleSttWorker();
});

afterEach(() => {
  recycleSttWorker();
  if (originalBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = originalBin;
  invalidateOmpCliCache();
  removeDir(dir);
});

/** Point the worker at `source` and clear the resolved-binary cache. */
async function useWorker(source: string, label: string): Promise<void> {
  Bun.env.KABMO_OMP_BIN = await executableStub(source, label);
  invalidateOmpCliCache();
}

describe('sttWorker', () => {
  test('sends the utterance as the $pcm payload and returns the answer', async () => {
    await useWorker(SPEAKING_WORKER, 'fake-omp-stt-speaking');

    const text = await sttWorker().transcribe(new Float32Array(16_000), { language: 'en' });

    // 16 000 Float32 samples travel as 64 000 bytes of payload, named `audio`.
    expect(text).toBe('64000:audio');
  });

  test('a worker that dies before answering names the mismatch, not a crash', async () => {
    await useWorker(DEAD_WORKER, 'fake-omp-stt-dead');

    const failure = await sttWorker()
      .transcribe(new Float32Array(16_000), {})
      .then(() => 'resolved')
      .catch((error: unknown) => (error instanceof Error ? error.message : String(error)));

    expect(failure).toContain('exited before answering');
    expect(failure).toContain('Update Kabmo');
    expect(failure).not.toBe('STT worker exited.');
  });

  test('the probe reports the same cause to the settings page', async () => {
    await useWorker(DEAD_WORKER, 'fake-omp-stt-dead');

    const probe = await sttWorker().probe();

    expect(probe.ok).toBe(false);
    expect(probe.error).toContain('exited before answering');
  });

  test('a worker that answered and then died is a crash, and the next call reconnects', async () => {
    await useWorker(SPEAKING_WORKER, 'fake-omp-stt-speaking');

    expect(await sttWorker().transcribe(new Float32Array(1_600), {})).toBe('6400:audio');
    // Recycle kills the live worker; the next utterance must spawn a new one
    // rather than answering from a dead pipe.
    recycleSttWorker();
    expect(await sttWorker().transcribe(new Float32Array(1_600), {})).toBe('6400:audio');
  });

  test('two utterances in flight at once both resolve', async () => {
    await useWorker(SPEAKING_WORKER, 'fake-omp-stt-speaking');

    const [first, second] = await Promise.all([
      sttWorker().transcribe(new Float32Array(1_600), {}),
      sttWorker().transcribe(new Float32Array(3_200), {}),
    ]);

    expect([first, second].sort()).toEqual(['12800:audio', '6400:audio']);
  });
});
