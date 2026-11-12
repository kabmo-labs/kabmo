/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "wait for session" popover, rendered: the search row narrows the running
 * sessions and never offers a row the filter hid.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { WaitingDependencyPicker } from '@/client/components/workspace/chat-timeline/chat-input/WaitingDependencyPicker';

const candidates = [
  { id: 'sess-a', title: 'Refactor parser', folderName: 'alpha' },
  { id: 'sess-b', title: 'Build pipeline', folderName: 'beta' },
];

const mounted: HTMLElement[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  for (const host of mounted.splice(0)) {
    render(null, host);
    host.remove();
  }
});

afterAll(() => {
  restoreDomGlobals();
});

async function mount(node: h.JSX.Element): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(node, host);
  });
  mounted.push(host);
  return host;
}

describe('WaitingDependencyPicker search', () => {
  test('the search row narrows the running sessions on title and folder name', async () => {
    const host = await mount(
      h(WaitingDependencyPicker, { candidates, value: null, onChange: () => {} }),
    );

    await act(async () => {
      (host.querySelector('[data-testid="wait-picker"]') as HTMLButtonElement).click();
    });
    const input = host.querySelector('input[aria-label="Search running sessions"]') as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      input.value = 'beta';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const ids = [...host.querySelectorAll('[data-testid="wait-candidate"]')].map((row) =>
      row.getAttribute('data-session-id'),
    );
    expect(ids).toEqual(['sess-b']);
  });
});
