/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The log's tail-follow, rendered for real against happy-dom.
 *
 * Three behaviours, and each is why the implementation is not "always scroll":
 *
 * - **A streaming run is followed.** The box is capped at `max-h-72`, so a run
 *   that prints past the cap would otherwise show its first lines forever.
 * - **Scrolling up disengages the follow.** The reader looking at an earlier
 *   failure is the one case a jump must not steal, and only their own scroll can
 *   say so — no timer or heuristic can.
 * - **Returning to the bottom re-engages it**, and so does a NEW run: the tail
 *   the reader was holding onto no longer exists.
 *
 * happy-dom computes no layout, so `scrollHeight`/`clientHeight` are installed on
 * the rendered element as getters. `scrollTop` is the browser's own property,
 * which is what the component writes and reads.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { RunOutput } from './Output';
import type { RunLog, RunSummary } from '../protocol';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let contentHeight = 1000;
let viewportHeight = 200;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
});

let container: HTMLDivElement;

afterEach(() => {
  container?.remove();
});

/** Install the metrics happy-dom does not compute. */
function measure(pre: HTMLPreElement): void {
  Object.defineProperty(pre, 'scrollHeight', { configurable: true, get: () => contentHeight });
  Object.defineProperty(pre, 'clientHeight', { configurable: true, value: viewportHeight });
}

function run(id = 'run-1'): RunSummary {
  return {
    id,
    sessionId: 's1',
    scopeKey: '/repo\0.',
    commandId: 'package.json#script:build',
    file: 'package.json',
    label: 'bun run build',
    background: false,
    status: 'running',
    startedAt: 0,
    endedAt: null,
    exitCode: null,
    signal: null,
    bytes: 0,
    ringBytes: 0,
  };
}

function log(text: string): RunLog {
  return {
    id: 'run-1',
    status: 'running',
    exitCode: null,
    signal: null,
    bytes: text.length,
    ringBytes: text.length,
    truncated: false,
    text,
  };
}

/** Render one state into the shared container and return the log element. */
function paint(nextRun: RunSummary, nextLog: RunLog): HTMLPreElement {
  render(h(RunOutput, { run: nextRun, log: nextLog, onStop: () => {} }), container);
  return container.querySelector('pre') as HTMLPreElement;
}

describe('RunOutput tail-follow', () => {
  test('follows a streaming run from its first paint', () => {
    container = document.createElement('div') as HTMLDivElement;
    document.body.appendChild(container);

    const pre = paint(run(), log('first line'));
    measure(pre);
    // The first paint happens before the metrics exist; the next publish is the
    // first one that can move. Following is ON by default, which is the claim.
    contentHeight = 1400;
    paint(run(), log('first line\nsecond line'));

    // happy-dom does not clamp `scrollTop` to the scroll range; a browser lands
    // on `contentHeight - viewportHeight`, the same tail.
    expect(pre.scrollTop).toBe(1400);
  });

  test('a reader who scrolls up is not dragged back down by the next publish', () => {
    container = document.createElement('div') as HTMLDivElement;
    document.body.appendChild(container);

    const pre = paint(run(), log('first line'));
    measure(pre);
    contentHeight = 1400;
    paint(run(), log('first line\nsecond line'));

    pre.scrollTop = 200;
    pre.dispatchEvent(new window.Event("scroll"));

    contentHeight = 1800;
    paint(run(), log('first line\nsecond line\nthird line'));

    expect(pre.scrollTop).toBe(200);
  });

  test('scrolling back to the bottom resumes the follow', () => {
    container = document.createElement('div') as HTMLDivElement;
    document.body.appendChild(container);

    const pre = paint(run(), log('first line'));
    measure(pre);
    contentHeight = 1400;
    paint(run(), log('first line\nsecond line'));

    pre.scrollTop = 200;
    pre.dispatchEvent(new window.Event("scroll"));

    pre.scrollTop = 1200;
    pre.dispatchEvent(new window.Event("scroll"));

    contentHeight = 1600;
    paint(run(), log('first line\nsecond line\nthird line'));

    expect(pre.scrollTop).toBe(1600);
  });

  test('a re-run starts following again, because the old tail is gone', () => {
    container = document.createElement('div') as HTMLDivElement;
    document.body.appendChild(container);

    const pre = paint(run(), log('first line'));
    measure(pre);
    contentHeight = 1400;
    paint(run(), log('first line\nsecond line'));

    pre.scrollTop = 200;
    pre.dispatchEvent(new window.Event("scroll"));

    contentHeight = 900;
    paint(run('run-2'), log('fresh output'));

    expect(pre.scrollTop).toBe(900);
  });
});
