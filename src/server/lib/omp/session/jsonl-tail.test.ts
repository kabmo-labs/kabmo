/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The tail reader, and the fallback that makes it safe.
 *
 * `loadSessionModel` and `loadSessionThinkingLevel` answer "the last record of
 * this type", and omp appends those records as the user changes them — so the
 * answer is at the END of the file. Reading the whole transcript to find it was
 * measured as two of the four full reads one `GET /api/chat/:id` performed on an
 * 11 MB session, and under 20 concurrent requests each of those reads held its own
 * copy of the string and of the parsed records (1.69 GB peak).
 *
 * Two ways this can be wrong, and both are silent:
 *
 * 1. **A truncated window.** The byte offset lands mid-line, so the first
 *    fragment is half a JSON object. Handing it to the lenient parser would
 *    invent a record that never existed.
 * 2. **A miss that is not a miss.** The last change can predate the window — a
 *    session configured once and then run for a hundred turns. Answering
 *    `undefined` there drops the model from the composer with no error at all.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readJsonlTail } from '@/server/lib/omp/session/jsonl-tail';
import { loadSessionModel, loadSessionThinkingLevel } from '@/server/lib/omp/session/messages';

const dir = mkdtempSync(path.join(tmpdir(), 'kabmo-jsonl-tail-'));

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

let seq = 0;
/** Write a session file and answer its path. */
function session(records: Array<Record<string, unknown>>): string {
  seq += 1;
  const file = path.join(dir, `s${seq}.jsonl`);
  writeFileSync(file, records.map((record) => `${JSON.stringify(record)}\n`).join(''));
  return file;
}

/** A turn's worth of bytes, so a file can be pushed past a tail window. */
const padding = (bytes: number): Record<string, unknown> => ({
  type: 'message',
  message: { role: 'user', content: 'x'.repeat(bytes) },
});

const parse = (body: string): Record<string, unknown>[] =>
  body
    .split('\n')
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

describe('readJsonlTail', () => {
  test('a file shorter than the window is read whole, and says so', async () => {
    const file = session([{ type: 'a' }, { type: 'b' }]);
    const tail = await readJsonlTail(file, 4096, parse);
    expect(tail.complete).toBe(true);
    expect(tail.records.map((r) => r.type)).toEqual(['a', 'b']);
  });

  test('a window that starts mid-line drops the fragment instead of parsing it', async () => {
    // 400 bytes of padding puts the window boundary inside a record.
    const file = session([{ type: 'a' }, padding(400), { type: 'b' }]);
    const tail = await readJsonlTail(file, 200, parse);
    expect(tail.complete).toBe(false);
    // The half-record is gone; the whole record after it is intact.
    expect(tail.records.every((record) => typeof record.type === 'string')).toBe(true);
    expect(tail.records.map((r) => r.type)).toEqual(['b']);
  });

  test('a window with no newline at all answers nothing, so the caller re-reads', async () => {
    const file = session([padding(1000)]);
    const tail = await readJsonlTail(file, 100, parse);
    expect(tail.records).toEqual([]);
    expect(tail.complete).toBe(false);
  });

  test('a missing file is not an error', async () => {
    const tail = await readJsonlTail(path.join(dir, 'nope.jsonl'), 1024, parse);
    expect(tail).toEqual({ records: [], complete: false });
  });
});

describe('loadSessionModel', () => {
  test('the LAST change wins', async () => {
    const file = session([
      { type: 'model_change', model: 'anthropic/claude-haiku' },
      { type: 'model_change', model: 'openai/gpt-5' },
    ]);
    expect(await loadSessionModel(file)).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  test('a change older than the tail window is still found', async () => {
    // The failure this pins: the answer predates the window, so a tail-only
    // reader reports "no model" and the composer loses it silently.
    const file = session([
      { type: 'model_change', model: 'anthropic/claude-haiku' },
      padding(600 * 1024),
    ]);
    expect(await loadSessionModel(file)).toEqual({ provider: 'anthropic', modelId: 'claude-haiku' });
  });

  test('a change INSIDE the tail window needs no second read', async () => {
    const file = session([padding(600 * 1024), { type: 'model_change', model: 'openai/gpt-5' }]);
    expect(await loadSessionModel(file)).toEqual({ provider: 'openai', modelId: 'gpt-5' });
  });

  test('a session that never changed model answers undefined', async () => {
    const file = session([padding(10)]);
    expect(await loadSessionModel(file)).toBeUndefined();
  });

  test('a malformed selector is refused rather than half-parsed', async () => {
    // `anthropic/` names no model, and a half-parsed `{provider, modelId: ''}`
    // would put an unloadable selection in the composer.
    const file = session([{ type: 'model_change', model: 'anthropic/' }]);
    expect(await loadSessionModel(file)).toBeUndefined();
  });
});

describe('loadSessionThinkingLevel', () => {
  test('the LAST level wins', async () => {
    const file = session([
      { type: 'thinking_level_change', thinkingLevel: 'low' },
      { type: 'thinking_level_change', thinkingLevel: 'high' },
    ]);
    expect(await loadSessionThinkingLevel(file)).toBe('high');
  });

  test('a level older than the tail window is still found', async () => {
    const file = session([
      { type: 'thinking_level_change', thinkingLevel: 'medium' },
      padding(600 * 1024),
    ]);
    expect(await loadSessionThinkingLevel(file)).toBe('medium');
  });
});
