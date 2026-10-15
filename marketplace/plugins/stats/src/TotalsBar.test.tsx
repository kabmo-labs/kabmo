/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The totals strip, rendered from a fixed snapshot.
 *
 * A snapshot is a plain object, so the three states that are easy to get wrong
 * are pinned by building one directly rather than by driving a live server: the
 * "first sample" note is visible only between the first and second sample (a
 * window the sampling loop closes in about a second, which a browser test
 * cannot reliably hit), and a snapshot with no rate must never print `0.0%`.
 *
 * The component is rendered through the kit's own Preact, with happy-dom
 * installed by the test — the same shape the example plugin's suite uses.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import type { ComponentChild } from 'preact';

import { TotalsBar } from './TotalsBar';
import type { ProcessRow, StatsSnapshot } from './sampler';

/** A row with no rate yet — the first sample's shape. */
function row(overrides: Partial<ProcessRow> = {}): ProcessRow {
  return {
    pid: 100,
    ppid: 1,
    title: 'OMPChamber server',
    detail: 'the server itself',
    groupKey: 'chamber',
    depth: 0,
    rss: 1024 * 1024,
    cpuPercent: null,
    threads: 4,
    ...overrides,
  };
}

function snapshot(rows: ProcessRow[]): StatsSnapshot {
  return {
    sampledAt: Date.now(),
    probe: { name: 'fake', supported: true },
    rows,
    groups: [
      {
        key: 'chamber',
        kind: 'chamber',
        ownerPid: 100,
        title: 'OMPChamber server',
        detail: 'the server itself',
        processes: rows.length,
        rss: 1024 * 1024,
        cpuPercent: 0,
      },
    ],
    total: { processes: rows.length, rss: 1024 * 1024, cpuPercent: 0 },
    machine: { totalMemBytes: 16 * 1024 ** 3, freeMemBytes: 4 * 1024 ** 3, cpuCount: 8, loadPerCore: 0.25 },
    daemons: [],
    serverPid: 100,
  };
}

/** Install just enough DOM for Preact to render into. */
const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
type DomGlobal = (typeof DOM_GLOBALS)[number];
const saved = new Map<DomGlobal, unknown>();

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  for (const key of DOM_GLOBALS) {
    saved.set(key, Reflect.get(globalThis, key));
    Reflect.set(globalThis, key, (win as unknown as Record<string, unknown>)[key]);
  }
});

afterAll(() => {
  for (const key of DOM_GLOBALS) Reflect.set(globalThis, key, saved.get(key));
});

/** Render `node` into a detached container and hand back both the text and it. */
function mount(node: ComponentChild): { container: HTMLElement; text: string } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(node, container);
  return { container, text: container.textContent ?? '' };
}

function unmount(container: HTMLElement): void {
  render(null, container);
  container.remove();
}

describe('TotalsBar', () => {
  test('the first-sample note shows when no row has a rate yet', () => {
    // The state the sampling loop makes brief and a browser test cannot catch:
    // every row reports `cpuPercent: null` until the second sample.
    const { container, text } = mount(
      <TotalsBar snapshot={snapshot([row()])} onRefresh={() => {}} refreshing={false} />,
    );
    expect(text).toContain('First sample');
    unmount(container);
  });

  test('the note is gone as soon as a rate exists', () => {
    const { container, text } = mount(
      <TotalsBar snapshot={snapshot([row({ cpuPercent: 3.5 })])} onRefresh={() => {}} refreshing={false} />,
    );
    expect(text).not.toContain('First sample');
    unmount(container);
  });

  test('a snapshot with no rows does not claim a first sample', () => {
    const { container, text } = mount(
      <TotalsBar snapshot={snapshot([])} onRefresh={() => {}} refreshing={false} />,
    );
    expect(text).not.toContain('First sample');
    unmount(container);
  });

  test('the refresh button carries an accessible name and its own disabled state', () => {
    // A bare glyph is unreachable by keyboard and unaddressable by a test, so
    // the control is pinned as a real labelled button.
    const idle = mount(<TotalsBar snapshot={snapshot([row()])} onRefresh={() => {}} refreshing={false} />);
    const button = idle.container.querySelector('button[aria-label="Refresh stats"]');
    expect(button).not.toBeNull();
    expect(button?.getAttribute('title')).toBe('Take a sample now');
    expect((button as HTMLButtonElement).disabled).toBe(false);
    unmount(idle.container);

    const busy = mount(<TotalsBar snapshot={snapshot([row()])} onRefresh={() => {}} refreshing />);
    const busyButton = busy.container.querySelector('button[aria-label="Refresh stats"]');
    expect((busyButton as HTMLButtonElement).disabled).toBe(true);
    unmount(busy.container);
  });
});
