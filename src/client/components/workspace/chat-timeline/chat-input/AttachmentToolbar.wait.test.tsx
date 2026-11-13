/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The "wait for session" pick lives in the composer HEADER, immediately before
 * the stretch control, on both layouts — and its popover opens DOWNWARD,
 * because the header is the card's top edge.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { AttachmentToolbar } from '@/client/components/workspace/chat-timeline/chat-input/AttachmentToolbar';

const candidates = [{ id: 'sess-a', title: 'Refactor parser', folderName: 'alpha' }];

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

describe('AttachmentToolbar wait pick', () => {
  test('the pick sits immediately before the stretch control', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates, onChange: () => {} },
      }),
    );

    const picker = host.querySelector('[data-testid="wait-picker"]');
    const expand = host.querySelector('[aria-label="Maximize composer"]');
    expect(picker).not.toBeNull();
    expect(expand).not.toBeNull();
    // The picker comes first in document order: `compareDocumentPosition`
    // reports FOLLOWING for a node that comes after.
    expect(picker!.compareDocumentPosition(expand!) & 4).toBe(4);
  });

  test('the popover opens downward from the header row', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates, onChange: () => {} },
      }),
    );

    await act(async () => {
      (host.querySelector('[data-testid="wait-picker"]') as HTMLButtonElement).click();
    });

    const popover = host.querySelector('.glass-popover');
    expect(popover).not.toBeNull();
    expect(popover!.className).toContain('top-full');
    expect(popover!.className).not.toContain('bottom-full');
  });

  test('nothing is drawn while there is no running session and no pick', async () => {
    const host = await mount(
      h(AttachmentToolbar, {
        attachments: [],
        onFilesSelected: () => {},
        onRemove: () => {},
        onToggleExpand: () => {},
        waiting: { value: null, candidates: [], onChange: () => {} },
      }),
    );

    expect(host.querySelector('[data-testid="wait-picker"]')).toBeNull();
  });
});
