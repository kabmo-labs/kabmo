/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The kill dialog: the states that decide whether a destructive control is
 * usable or dangerous.
 *
 * The table's `×` is 16px in a dense row, so the dialog is the whole safety
 * margin. What this pins:
 *
 *  - Cancel holds focus on open, so Enter on an accidental open does nothing;
 *  - Escape cancels;
 *  - a refusal from the server is rendered INSIDE the dialog (a close-and-drop
 *    would leave the reader pressing a button that never works);
 *  - while the call is in flight the stop button is disabled and says so.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';

import { KillConfirm } from './KillConfirm';
import type { ProcessRow } from './snapshot';

// `requestAnimationFrame` is part of the list because Preact's effects are
// flushed on the next frame when one is available: without it the hooks module
// waits out its own 100 ms fallback, and every assertion here reads a dialog
// whose listeners are not attached yet.
const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'Node',
  'Text',
  'Element',
  'SVGElement',
  'requestAnimationFrame',
  'cancelAnimationFrame',
] as const;
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

afterEach(() => {
  document.body.innerHTML = '';
});

const ROW: ProcessRow = {
  pid: 4242,
  ppid: 100,
  title: 'omp · rpc-ui · kabmo',
  detail: '/Users/me/projects/kabmo · 12m',
  groupKey: 'session',
  depth: 1,
  memory: 134 * 1024 * 1024,
  memorySource: 'footprint',
  rss: 317 * 1024 * 1024,
  cpuPercent: 3.5,
  threads: 12,
};

/**
 * Preact runs effects after paint, so a mount is not "ready" until one tick has
 * passed. Without the tick the Escape listener is not attached yet and the
 * autofocus has not happened — and the effect lands AFTER the test's cleanup,
 * which is how this suite used to fail between tests instead of inside one.
 */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function dialogFor(overrides: Partial<Parameters<typeof KillConfirm>[0]> = {}) {
  const calls = { cancel: 0, confirm: 0 };
  const container = document.createElement('div');
  document.body.appendChild(container);
  render(
    <KillConfirm
      row={ROW}
      pending={false}
      error={null}
      onCancel={() => {
        calls.cancel += 1;
      }}
      onConfirm={() => {
        calls.confirm += 1;
      }}
      {...overrides}
    />,
    container,
  );
  await settle();
  return { container, calls };
}

describe('KillConfirm', () => {
  test('names the process, its pid and the memory it holds', async () => {
    const { container } = await dialogFor();
    const text = container.textContent ?? '';
    expect(text).toContain('Stop pid 4242?');
    expect(text).toContain('omp · rpc-ui · kabmo');
    expect(text).toContain('134.0 MB');
    expect(text).toContain('SIGTERM');
  });

  test('Cancel holds focus on open, so Enter cannot kill anything', async () => {
    const { container } = await dialogFor();
    const buttons = [...container.querySelectorAll('button')];
    expect(document.activeElement).toBe(buttons[0]);
    expect(buttons[0].textContent).toBe('Cancel');
  });

  test('Escape cancels', async () => {
    const { container, calls } = await dialogFor();
    const event = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    window.dispatchEvent(event);
    expect(calls.cancel).toBe(1);
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  test('a refusal from the server is shown inside the dialog', async () => {
    const { container } = await dialogFor({ error: 'pid 4242 belongs to another user, so it cannot be signalled.' });
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('another user');
  });

  test('the stop button disables and relabels itself while in flight', async () => {
    const { container } = await dialogFor({ pending: true });
    const buttons = [...container.querySelectorAll('button')];
    const stop = buttons.find((button) => button.textContent?.includes('Stopping'));
    expect(stop).toBeDefined();
    expect((stop as HTMLButtonElement).disabled).toBe(true);
  });

  test('Stop process confirms, and the backdrop dismisses', async () => {
    const { container, calls } = await dialogFor();
    const buttons = [...container.querySelectorAll('button')];
    const stop = buttons.find((button) => button.textContent === 'Stop process');
    stop?.click();
    expect(calls.confirm).toBe(1);

    const backdrop = container.querySelector('.fixed');
    backdrop?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(calls.cancel).toBe(1);
  });
});