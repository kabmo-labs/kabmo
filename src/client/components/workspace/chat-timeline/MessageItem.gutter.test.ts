/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a framed transcript block's edge lands, per layout.
 *
 * The phone's gutter is the timeline container's own `px-3` — the same 12px
 * the composer dock uses — so a block that adds `mx-3` on top of it sits 12px
 * inside the composer's card. That is what this pins: the same tree, mounted
 * twice, and the only difference is `isMobile`.
 *
 * Asserted through the rendered DOM rather than the helper, because the bug
 * was a call site that never passed the flag: `transcriptGutter` can be
 * perfect and a `ChatMessageItem` that drops `isMobile` still renders `mx-3`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ChatMessageItem } from '@/client/components/workspace/chat-timeline/MessageItem';
import { SessionStateProvider } from '@/client/components/common/session-state-provider';
import type { ChatMessageData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

let container: HTMLElement | null = null;

beforeEach(() => {
  container?.remove();
  container = null;
});

/** A user row, and an AI row carrying one tool call — the two framed blocks. */
const userRow: ChatMessageData = { id: 'u1', role: 'user', content: 'hello' };
const toolRow: ChatMessageData = {
  id: 'a1',
  role: 'ai',
  content: 'done',
  toolCalls: [{
    id: 't1',
    type: 'bash',
    title: 'Bash',
    command: 'echo hi',
    output: 'hi',
    status: 'success',
  }],
};

async function mount(msg: ChatMessageData, isMobile: boolean): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: 'gutter-test',
        children: h(ChatMessageItem, { msg, isMobile }),
      }),
      host,
    );
  });
  container = host;
  return host;
}

/** The user bubble: the framed block a user row draws. */
function bubble(host: HTMLElement): HTMLElement {
  return host.querySelector('div.bg-paper.rounded-xl') as HTMLElement;
}

describe('transcript block gutter', () => {
  test('a phone draws the user bubble at the container gutter, with no extra inset', async () => {
    const host = await mount(userRow, true);
    const box = bubble(host);
    expect(box.className).not.toContain('mx-3');
    // And its padding is the one that lands text on the 24px column.
    expect(box.className).toContain('p-3');
    expect(box.className).not.toContain('p-3.5');
  });

  test('desktop keeps the inset frame and the roomier padding', async () => {
    const host = await mount(userRow, false);
    const box = bubble(host);
    expect(box.className).toContain('mx-3');
    expect(box.className).toContain('p-3.5');
  });

  test('the tool section follows the same rule — and is reachable by its own marker', async () => {
    const phone = await mount(toolRow, true);
    const phoneSection = phone.querySelector('[data-tool-section]') as HTMLElement;
    expect(phoneSection).not.toBeNull();
    expect(phoneSection.className).not.toContain('mx-3');

    const desktop = await mount(toolRow, false);
    const desktopSection = desktop.querySelector('[data-tool-section]') as HTMLElement;
    expect(desktopSection.className).toContain('mx-3');
  });
});
