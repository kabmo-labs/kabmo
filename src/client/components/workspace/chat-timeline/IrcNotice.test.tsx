/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The card a peer agent's message renders as.
 *
 * omp 18.18.9 stopped returning received messages inside a `wait` result and
 * injects each one as an `irc:incoming` turn; the turn's content is the model's
 * `<irc>` prompt envelope. This card must show the sender and the body from
 * `details`, never that envelope — a regression here puts prompt scaffolding and
 * the reply instructions into the transcript.
 *
 * Mounted with `h()` against happy-dom, following `block-chrome.test.tsx`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { IrcNotice } from '@/client/components/workspace/chat-timeline/IrcNotice';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

beforeAll(() => installDomGlobals(new Window({ url: 'http://localhost' })));
afterAll(() => restoreDomGlobals());

async function paint(irc: Parameters<typeof IrcNotice>[0]['irc']): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(h(IrcNotice, { irc }), container);
  });
  return container;
}

describe('IrcNotice', () => {
  test('names the sender and shows the raw body', async () => {
    const el = await paint({ from: 'Sleeper', message: 'sleeper reporting in' });
    const text = el.textContent ?? '';
    expect(text).toContain('Message from Sleeper');
    expect(text).toContain('sleeper reporting in');
    expect(text).not.toContain('<irc>');
    expect(text).not.toContain('reply via');
    el.remove();
  });

  test('names a reply target and a progress message', async () => {
    const el = await paint({ from: 'Scout', message: 'map is ready', replyTo: 'main', progress: true });
    const text = el.textContent ?? '';
    expect(text).toContain('reply to main');
    expect(text).toContain('progress');
    el.remove();
  });
});
