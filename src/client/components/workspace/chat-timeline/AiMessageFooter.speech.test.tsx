/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The assistant footer's speaker action.
 *
 * Two contracts: the button follows the RUN (the answer's own id, never the
 * Retry anchor), and it survives `showActions={false}` — reading is not a chat
 * action, so the BTW panel's answer keeps it. A footer with no TTS provider
 * draws nothing rather than a dead control.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { RunFooter } from '@/client/components/workspace/chat-timeline/RunFooter';
import { TtsContext, type TtsHandle } from '@/client/hooks/tts/tts-context';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChatMessageData } from '@/shared/types';

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.body.appendChild(document.createElement('div'));
});

afterEach(() => {
  render(null, container);
  container.remove();
});

afterAll(() => restoreDomGlobals());

function mount(node: preact.ComponentChild): HTMLElement {
  act(() => {
    render(node, container);
  });
  return container;
}

const answerRow: ChatMessageData = {
  id: 'ai-7',
  role: 'ai',
  content: 'the answer',
  model: 'gpt-5',
  provider: 'openai',
};

function handle(overrides: Partial<TtsHandle> = {}): TtsHandle {
  return {
    enabled: true,
    status: 'idle',
    activeKey: null,
    error: null,
    speak: () => {},
    stop: () => {},
    ...overrides,
  };
}

function withTts(node: preact.ComponentChild, value: TtsHandle): HTMLElement {
  return mount(h(TtsContext.Provider, { value }, node));
}

describe('assistant footer speech', () => {
  test('reads the run, not the Retry anchor', () => {
    const spoken: Array<{ text: string; key: string }> = [];
    const el = withTts(
      h(RunFooter, { msg: answerRow, retryTargetId: 'user-3' }),
      handle({ speak: (text, key) => spoken.push({ text, key }) }),
    );

    const button = el.querySelector('button[aria-label="Read answer aloud"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    act(() => button!.click());

    expect(spoken).toEqual([{ text: 'the answer', key: 'ai-7' }]);
  });

  test('while active it is a stop control', () => {
    let stopped = 0;
    const el = withTts(
      h(RunFooter, { msg: answerRow }),
      handle({ status: 'playing', activeKey: 'ai-7', stop: () => { stopped += 1; } }),
    );

    const button = el.querySelector('button[aria-label="Stop reading"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-pressed')).toBe('true');
    act(() => button!.click());
    expect(stopped).toBe(1);
  });

  test('an empty answer disables the button instead of reading nothing', () => {
    const el = withTts(
      h(RunFooter, { msg: { ...answerRow, content: '...' } }),
      handle(),
    );
    const button = el.querySelector('button[aria-label="Read answer aloud"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.disabled).toBe(true);
  });

  test('showActions=false keeps the speaker', () => {
    const el = withTts(
      h(RunFooter, { msg: answerRow, showActions: false }),
      handle(),
    );
    expect(el.querySelector('button[aria-label="Read answer aloud"]')).not.toBeNull();
    expect(el.querySelector('button[aria-label="Retry response"]')).toBeNull();
  });

  test('no provider draws no button', () => {
    const el = mount(h(RunFooter, { msg: answerRow }));
    expect(el.querySelector('button[aria-label="Read answer aloud"]')).toBeNull();
  });

  test('the phone sheet offers the same action and closes on start', () => {
    const spoken: string[] = [];
    const el = withTts(
      h(RunFooter, { msg: answerRow, isMobile: true }),
      handle({ speak: (_text, key) => spoken.push(key) }),
    );

    act(() => {
      (el.querySelector('button[aria-label="More actions"]') as HTMLButtonElement).click();
    });
    const button = el.querySelector('[role="dialog"] button[aria-label="Read answer aloud"]') as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    act(() => button!.click());

    expect(spoken).toEqual(['ai-7']);
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });
});
