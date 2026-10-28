/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { join } from 'path';

import { scanSessionInfo } from '@/server/lib/omp/session/files';

/**
 * `modified` is the session's last real activity, and two signals that look
 * like it are not:
 *
 *   - the file mtime, which a title-slot rename bumps without a turn having
 *     happened (measured: 5 days of skew on a real session);
 *   - a `session_exit` lifecycle marker, written per process dispose, which
 *     floats a session quiet for days to the top of the sidebar (measured: 255
 *     of 319 sessions ranked by one).
 *
 * The cost of regressing either is a silently wrong sidebar order, which no
 * other test observes.
 */

const tempDirs: string[] = [];

/** Write a session file whose lines are exactly the given records, in order. */
async function writeSession(lines: unknown[]): Promise<string> {
  const dir = await fs.promises.mkdtemp('omp-session-files-');
  tempDirs.push(dir);
  const file = join(dir, 'session.jsonl');
  await Bun.write(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return file;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const at = (day: number, second = 0) =>
  `2026-09-${String(day).padStart(2, '0')}T03:00:${String(second).padStart(2, '0')}.000Z`;

const slot = (title: string) => ({ type: 'title', v: 1, title, updatedAt: at(1), pad: '' });
const header = { type: 'session', version: 3, id: 'session-id', cwd: '/tmp/proj', timestamp: at(1) };
const message = (day: number, text = 'hello') => ({
  type: 'message',
  id: `m-${day}`,
  parentId: null,
  timestamp: at(day),
  message: { role: 'user', content: [{ type: 'text', text }] },
});
/** The marker omp appends every time it disposes the session process. */
const sessionExit = (day: number) => ({
  type: 'custom',
  customType: 'session_exit',
  data: { reason: 'dispose', kind: 'normal', recordedAt: at(day) },
  id: `x-${day}`,
  parentId: null,
  timestamp: at(day),
});
const toolStart = (day: number) => ({
  type: 'custom',
  customType: 'tool_execution_start',
  data: { toolCallId: 'call', toolName: 'bash' },
  id: `t-${day}`,
  parentId: null,
  timestamp: at(day),
});

describe('scanSessionInfo last activity', () => {
  test('dates the session by its newest entry, not the file mtime', async () => {
    // The mtime is "now" (just written); only the entry timestamp is the answer.
    const file = await writeSession([slot('t'), header, message(10)]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(10));
    expect(info?.modified.getTime()).not.toBe(info?.fileMtime.getTime());
  });

  test('ignores a trailing session_exit marker', async () => {
    const file = await writeSession([slot('t'), header, message(10), sessionExit(20)]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(10));
  });

  test('ignores a stack of session_exit markers, however many accumulated', async () => {
    const file = await writeSession([
      slot('t'),
      header,
      message(11),
      sessionExit(20),
      sessionExit(21),
      sessionExit(22),
    ]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(11));
  });

  test('still counts an in-flight tool call as activity', async () => {
    // A run killed mid-tool-call has no later message, but it IS the newest
    // session. Excluding every custom entry would misrank it.
    const file = await writeSession([slot('t'), header, message(12), toolStart(13)]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(13));
  });

  test('counts an unrecognised custom entry rather than assuming it is bookkeeping', async () => {
    const file = await writeSession([
      slot('t'),
      header,
      message(12),
      { type: 'custom', customType: 'brand_new_marker', id: 'z', timestamp: at(19) },
    ]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(19));
  });

  test('uses a later message when the exit marker came first', async () => {
    const file = await writeSession([slot('t'), header, sessionExit(5), message(6)]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(6));
  });

  test('falls back to the creation time for a session with no activity at all', async () => {
    const file = await writeSession([slot('t'), header, sessionExit(30)]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(1));
  });

  test('reads the timestamp past an entry larger than the tail window', async () => {
    // A tool result carrying a big file read is the newest entry and is
    // usually the largest one; the window must widen to reach its line.
    const file = await writeSession([
      slot('t'),
      header,
      message(2, 'head'),
      message(4, 'x'.repeat(200_000)),
    ]);
    const info = await scanSessionInfo(file);
    expect(info?.modified.toISOString()).toBe(at(4));
  });

  test('returns undefined for a file with no session header', async () => {
    const file = await writeSession([slot('t'), message(3)]);
    expect(await scanSessionInfo(file)).toBeUndefined();
  });
});
