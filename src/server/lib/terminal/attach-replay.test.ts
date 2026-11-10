/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A viewer that attaches while output is in flight must receive the stream
 * exactly once: the replay's last line followed immediately by live output.
 *
 * The two ways this breaks are both silent, and both are duplicate/garbled text
 * in the terminal rather than an error. Output is appended to `history` and
 * queued for delivery, so a replay captured BEFORE the queue is flushed carries the pending
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

/**
 * The numbered lines in `text`, in arrival order.
 *
 * A trailing line with no newline after it is NOT counted: it is a line still
 * arriving, and its prefix is a number that happens to parse. The replay is
 * captured mid-flood by construction, so it routinely ends inside a line —
 * measured on the Linux gate, where the replay ended after the first two bytes
 * of `5136` and this helper turned that fragment into the line `51`, failing
 * `gap(replayed)` with `5135 -> 51 at 5134` on a terminal that was working. The
 * same rule makes the live collectors safe for the same reason: a line counts
 * once the shell has finished writing it.
 */
function numbers(text: string): number[] {
  const complete = text.endsWith('\n') ? text : text.slice(0, text.lastIndexOf('\n') + 1);
  return complete
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

  // …and the replay plus its live stream is ONE seamless rendering: no line
  // twice, none skipped. Asserted on the CONCATENATION rather than by comparing
  // `secondLines[0]` to the replay's last line, because the boundary is allowed
  // to land inside a line — the replay is captured mid-flood, and measured on
  // the Linux gate it ended two bytes into `5135`. A per-side comparison then
  // reads that fragment as its own line and reports a gap on a working
  // terminal; the concatenation is what the viewer actually renders, so a
  // duplicate or a hole still fails here.
  const combined = numbers(dec.decode(attachment.replay) + second.text());
  expect(secondLines.length).toBeGreaterThan(0);
  expect(gap(combined)).toBeNull();
  expect(new Set(combined).size).toBe(combined.length);
  expect(combined.at(-1)).toBe(TOTAL);
}, 60_000);
