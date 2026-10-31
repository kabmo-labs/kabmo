/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The streaming presence scan: one bit, without materializing the transcript.
 *
 * Why it exists is in the module doc; what this file pins is the agreement
 * with the roster fold (`subagent/history/fold.ts`), because a badge that
 * disagrees with the panel it opens is worse than a slow badge:
 *
 *  - a valid subagent id in `details.progress` or `details.results` is a hit;
 *  - an id the fold would reject (`../evil`, a dotted path fragment) is not;
 *  - a `task` toolResult that arrives AFTER a chunk boundary is still found —
 *    the scan streams, so the matching line is assembled across reads;
 *  - a plain tool result, an assistant toolCall without a result, and a
 *    lifecycle entry are not hits.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'node:os';

import { SESSION_PRESENCE_MAX_LINE_BYTES, sessionFileHasSubagents } from '@/server/lib/omp/session/subagent-presence-scan';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(join(tmpdir(), 'presence-scan-'));
  tempDirs.push(dir);
  return dir;
}

function writeLines(name: string, lines: unknown[]): string {
  const file = join(tempDir(), name);
  fs.mkdirSync(dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

function header(id = 'session'): Record<string, unknown> {
  return { type: 'session', version: 3, id, cwd: '/tmp/proj', timestamp: '2026-09-01T00:00:00.000Z' };
}

/** The exact shape the roster fold reads: a `task` toolResult with details. */
function taskResult(details: Record<string, unknown>): Record<string, unknown> {
  return {
    type: 'message',
    timestamp: '2026-09-01T00:00:10.000Z',
    message: { role: 'toolResult', toolName: 'task', toolCallId: 'call-1', details },
  };
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('sessionFileHasSubagents', () => {
  test('a session with no task result is not a hit', async () => {
    const file = writeLines('plain.jsonl', [
      header(),
      { type: 'message', timestamp: '2026-09-01T00:00:05.000Z', message: { role: 'user', content: 'hi' } },
      {
        type: 'message',
        timestamp: '2026-09-01T00:00:06.000Z',
        message: { role: 'toolResult', toolName: 'bash', details: { output: 'ok' } },
      },
    ]);
    expect(await sessionFileHasSubagents(file)).toBe(false);
  });

  test('an assistant task toolCall without a result is not a hit', async () => {
    // Presence comes from the RESULT fold, not from a call that never landed:
    // an aborted launch has no roster entry to show.
    const file = writeLines('call-only.jsonl', [
      header(),
      {
        type: 'message',
        timestamp: '2026-09-01T00:00:07.000Z',
        message: {
          role: 'assistant',
          content: [{ type: 'toolCall', id: 'call-1', name: 'task', arguments: { task: 'x' } }],
        },
      },
    ]);
    expect(await sessionFileHasSubagents(file)).toBe(false);
  });

  test('progress naming a subagent is a hit', async () => {
    const file = writeLines('progress.jsonl', [
      header(),
      taskResult({ progress: [{ id: 'AlphaBeta', agent: 'task', status: 'running' }] }),
    ]);
    expect(await sessionFileHasSubagents(file)).toBe(true);
  });

  test('results carrying a subagent id is a hit', async () => {
    const file = writeLines('results.jsonl', [header(), taskResult({ results: [{ id: 'GammaDelta', exitCode: 0 }] })]);
    expect(await sessionFileHasSubagents(file)).toBe(true);
  });

  test('an id the roster fold would reject is not a hit', async () => {
    const file = writeLines('traversal.jsonl', [header(), taskResult({ results: [{ id: '../evil' }] })]);
    expect(await sessionFileHasSubagents(file)).toBe(false);
  });

  test('a hit on the last line is found across chunk boundaries', async () => {
    // The scan streams, so the matching line is assembled from more than one
    // read. One oversized line before it proves the carry buffer survives.
    const big = 'x'.repeat(512 * 1024);
    const file = writeLines('streamed.jsonl', [
      header(),
      { type: 'message', timestamp: '2026-09-01T00:00:08.000Z', message: { role: 'toolResult', toolName: 'bash', details: { output: big } } },
      taskResult({ progress: [{ id: 'OmegaSigma', agent: 'task', status: 'running' }] }),
    ]);
    expect(await sessionFileHasSubagents(file)).toBe(true);
  });

  test('an unreadable file throws, so the caller can decide whether to remember', async () => {
    const missing = join(tempDir(), 'gone.jsonl');
    let threw = false;
    try {
      await sessionFileHasSubagents(missing);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test('the oversized-line ceiling is far above a real task result', () => {
    // A task result carries telemetry, not outputs; the cap exists to drop a
    // tool output that would otherwise be held in full.
    expect(SESSION_PRESENCE_MAX_LINE_BYTES).toBeGreaterThan(1024 * 1024);
  });
});