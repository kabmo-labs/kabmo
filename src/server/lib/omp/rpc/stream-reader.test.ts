/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The NDJSON reader that carries every frame from an omp child, and the
 * process-tree kill used to tear one down.
 *
 * Both sit on the child's lifecycle boundary where a mistake is silent:
 *
 *  - `readLines` replaced `readline`, so a chunk boundary that splits a line,
 *    a trailing line with no newline, or a multi-byte character split across
 *    chunks must not drop or corrupt a frame. A stream error must resolve the
 *    promise, never reject into an unhandled rejection, because the caller
 *    (`RpcProcess`) treats stdout EOF as the child's death.
 *  - `killProcessTree` signals the negative pid so an omp child's LSP and
 *    extension grandchildren die with it. The undefined-pid guard and the
 *    POSIX fallback are the parts a caller can reach without a live child.
 */

import { describe, expect, test } from 'bun:test';

import { readLines } from '@/server/lib/omp/rpc/lines';
import { killProcessTree } from '@/server/lib/lifecycle/kill-tree';

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(...chunks: string[]): Promise<string[]> {
  const lines: string[] = [];
  await readLines(streamOf(...chunks), (line) => lines.push(line));
  return lines;
}

describe('readLines', () => {
  test('emits each complete newline-terminated line in order, without the newline', async () => {
    expect(await collect('a\nb\nc\n')).toEqual(['a', 'b', 'c']);
  });

  test('buffers a line split across two chunks until it is complete', async () => {
    expect(await collect('{"type":"agent', '_start"}\n')).toEqual(['{"type":"agent_start"}']);
  });

  test('emits an empty string for a blank line, like readline', async () => {
    expect(await collect('a\n\nb\n')).toEqual(['a', '', 'b']);
  });

  test('emits trailing data that never received a newline when the stream closes', async () => {
    expect(await collect('a\nb')).toEqual(['a', 'b']);
  });

  test('reassembles a multi-byte character split across chunk boundaries', async () => {
    const bytes = new TextEncoder().encode('héllo\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    const lines: string[] = [];
    await readLines(stream, (line) => lines.push(line));
    expect(lines).toEqual(['héllo']);
  });

  test('resolves (never rejects) when the stream errors, keeping lines already emitted', async () => {
    const lines: string[] = [];
    const encoder = new TextEncoder();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++;
        if (pulls === 1) controller.enqueue(encoder.encode('first\n'));
        else controller.error(new Error('stdout broke'));
      },
    });
    await expect(readLines(stream, (line) => lines.push(line))).resolves.toBeUndefined();
    expect(lines).toEqual(['first']);
  });

  test('emits nothing for an empty stream', async () => {
    expect(await collect()).toEqual([]);
  });
});

describe('killProcessTree', () => {
  test('is a no-op without a pid (a spawn that never settled)', () => {
    expect(() => killProcessTree(undefined, true, 'SIGKILL')).not.toThrow();
  });

  test('swallows a signal to a pid that does not exist instead of throwing', () => {
    // 2^22 is above macOS's default pid ceiling and never assigned.
    expect(() => killProcessTree(4_194_303, true, 'SIGKILL')).not.toThrow();
  });

  test('kills a detached child by its process group on POSIX', async () => {
    if (process.platform === 'win32') return;
    const child = Bun.spawn({
      cmd: ['sleep', '30'],
      detached: true,
      stdout: 'ignore',
      stderr: 'ignore',
    });
    try {
      killProcessTree(child.pid, true, 'SIGKILL');
      // Await the real exit signal rather than a guessed delay; bun's own
      // per-test timeout fails this if the group signal never lands.
      const code = await child.exited;
      expect(typeof code).toBe('number');
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {}
    }
  });
});
