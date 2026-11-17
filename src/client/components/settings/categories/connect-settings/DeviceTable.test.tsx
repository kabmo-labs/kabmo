/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "Last connect" cell.
 *
 * A paired device's row must answer two questions: is anything still using this
 * pairing, and when exactly did it last connect? The relative label alone
 * answers neither once it reads "3 d ago", so the cell carries the exact moment
 * too. A device that never came back says "Never connected" rather than the
 * useless "never" or an empty cell.
 */

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { DeviceTable } from '@/client/components/settings/categories/connect-settings/DeviceTable';
import type { PairedDevice } from '@/shared/lib/connect/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let win: Window;
let container: HTMLElement | null = null;

beforeAll(() => {
  win = new Window({ url: 'http://192.168.1.5:3000' });
  installDomGlobals(win);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = null;
  document.body.replaceChildren();
});

afterAll(() => {
  restoreDomGlobals();
});

function device(overrides: Partial<PairedDevice> = {}): PairedDevice {
  return {
    id: 'device-1',
    name: 'Phone',
    platform: 'ios',
    route: null,
    rttMs: null,
    lastSeenAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

async function mount(devices: PairedDevice[]): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  container = host;
  await act(async () => {
    render(h(DeviceTable, { devices, busy: null, onRevoke: () => {}, onAdd: () => {} }), host);
  });
}

test('the column is named Last connect', async () => {
  await mount([device()]);
  const headers = [...document.querySelectorAll('th')].map((th) => th.textContent);
  expect(headers).toContain('Last connect');
  expect(headers).not.toContain('Last seen');
});

test('a device that never connected says so, in both layouts', async () => {
  await mount([device()]);
  const labels = [...document.querySelectorAll('td, li')].filter((node) =>
    node.textContent?.includes('Never connected'),
  );
  // One desktop cell and one phone line.
  expect(labels.length).toBe(2);
});

test('a connected device carries the relative and exact time', async () => {
  const iso = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  await mount([device({ lastSeenAt: iso })]);

  const times = [...document.querySelectorAll('time')];
  expect(times.length).toBe(1);
  expect(times[0]?.getAttribute('datetime')).toBe(iso);
  expect(times[0]?.textContent).toContain('3 h ago ·');
});
