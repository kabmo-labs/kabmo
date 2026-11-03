/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A viewer that attaches while output is in flight must receive the stream
 * exactly once: the replay's last line followed immediately by live output.
 *
 * The two ways this breaks are both silent, and both are duplicate/garbled text
 * in xterm rather than an error. Output is appended to `history` and queued for
 * delivery, so a replay captured BEFORE the queue is flushed carries the pending
 * bytes and the queued frame carries them again (each line printed twice); a
 * frame delivered before the replay arrives ahead of it in the wrong order.
 * `attachTerminal` flushes first for exactly this reason, and this is the test
 * that catches its removal.
 *
 * A REAL PTY on purpose: the seam only exists because reads and frames are
 * different things, and a fake producer would have to reproduce Bun's read sizes
 * to reproduce it. The assertions are on line numbers, which is what makes a gap
 * or a duplicate visible at all.
 */

import { afterAll, expect, test } from 'bun:test';
import { attachTerminal, forgetTerminal, writeTerminalInput } from '@/server/lib/terminal/runtime.server';
import type { TerminalViewer } from '@/server/lib/terminal/session.server';

const dec = new TextDecoder();
const TOTAL = 30_000;

interface Collected {
  viewer: TerminalViewer;
  frames: Uint8Array[];
  text: () => string;
}

function collector(): Collected {
  const frames: Uint8Array[] = [];
  return {
    viewer: {
      send(frame) {
        if (typeof frame !== 'string') frames.push(frame);
        return true;
      },
      drop() {},
    },
    frames,
    text: () => dec.decode(join(frames)),
  };
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** The numbered lines in `text`, in arrival order. */
function numbers(text: string): number[] {
  return text
    .split('\n')
    .map((line) => line.replace(/\r$/, '').trim())
    .filter((line) => /^\d+$/.test(line))
    .map(Number);
}

/** `null` when every line follows the previous one, else the offending pair. */
function gap(sequence: number[]): string | null {
  for (let i = 1; i < sequence.length; i++) {
    if (sequence[i] !== sequence[i - 1] + 1) return `${sequence[i - 1]} -> ${sequence[i]} at ${i}`;
  }
  return null;
}

async function until(predicate: () => boolean, timeoutMs = 20_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await Bun.sleep(5);
  }
  return false;
}

const ids: string[] = [];

afterAll(() => {
  for (const id of ids.splice(0)) forgetTerminal(id);
});

test('a viewer attaching mid-stream sees the replay and live output exactly once', async () => {
  const id = `attach-replay-${Bun.randomUUIDv7()}`;
  ids.push(id);

  const first = collector();
  await attachTerminal(first.viewer, { id, cols: 100, rows: 30, theme: 'dark' });

  writeTerminalInput(id, new TextEncoder().encode(`seq 1 ${TOTAL}\r`));
  expect(await until(() => numbers(first.text()).length > 2_000)).toBe(true);

  // Mid-flood by construction: the shell is emitting, the first viewer is
  // receiving, and the coalescer holds bytes that history already has.
  const second = collector();
  const attachment = await attachTerminal(second.viewer, { id, cols: 100, rows: 30, theme: 'dark' });
  const replayed = numbers(dec.decode(attachment.replay));

  expect(await until(() => numbers(first.text()).at(-1) === TOTAL)).toBe(true);
  expect(await until(() => numbers(second.text()).at(-1) === TOTAL)).toBe(true);

  const firstLines = numbers(first.text());
  const secondLines = numbers(second.text());

  // The viewer there from the start saw every line once, in order.
  expect(gap(firstLines)).toBeNull();
  expect(firstLines.length).toBe(new Set(firstLines).size);
  expect(firstLines.at(-1)).toBe(TOTAL);

  // The late viewer's replay is the retained scrollback, contiguous…
  expect(replayed.length).toBeGreaterThan(0);
  expect(gap(replayed)).toBeNull();

  // …and its live stream continues from the replay's last line: not one line
  // earlier (a duplicate) and not one line later (a gap).
  expect(secondLines.length).toBeGreaterThan(0);
  expect(secondLines[0]).toBe((replayed.at(-1) ?? 0) + 1);
  expect(gap([replayed.at(-1) ?? 0, ...secondLines])).toBeNull();
  expect(new Set(secondLines).size).toBe(secondLines.length);
  expect(secondLines.at(-1)).toBe(TOTAL);
}, 60_000);
