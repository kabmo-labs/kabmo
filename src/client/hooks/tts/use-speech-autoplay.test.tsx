/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Autoplay: once per run, only for a run this page watched settle, never for
 * history loaded on mount, and never when the setting is off.
 *
 * The player is a seam here (`speak`/`stop`), so the test observes the decision
 * without touching Audio, fetch or a real provider.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useSpeechAutoplay } from '@/client/hooks/tts/use-speech-autoplay';
import { DEFAULT_TTS_CONFIG } from '@/shared/lib/tts/settings';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { ChatMessageData } from '@/shared/types';

const messages: ChatMessageData[] = [
  { id: 'u1', role: 'user', content: 'question' },
  { id: 'a1', role: 'ai', content: 'the answer' },
];

let container: HTMLElement;

function Harness({ generating, speak, stop, msgs = messages }: {
  generating: boolean;
  speak: (text: string, key: string) => void;
  stop: () => void;
  msgs?: ChatMessageData[];
}) {
  useSpeechAutoplay({ messages: msgs, isGenerating: generating, sessionId: 's1', speak, stop });
  return null;
}

async function mount(
  generating: boolean,
  speak: (text: string, key: string) => void,
  stop: () => void,
  msgs: ChatMessageData[] = messages,
): Promise<void> {
  container = document.body.appendChild(document.createElement('div'));
  act(() => {
    render(h(Harness, { generating, speak, stop, msgs }), container);
  });
}

function settle(
  generating: boolean,
  speak: (text: string, key: string) => void,
  stop: () => void,
  msgs: ChatMessageData[] = messages,
): void {
  act(() => {
    render(h(Harness, { generating, speak, stop, msgs }), container);
  });
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

beforeEach(() => {
  vi.useFakeTimers();
  primeKabmoSettings({ tts: { ...DEFAULT_TTS_CONFIG, autoplay: true } });
});

afterEach(() => {
  vi.useRealTimers();
  if (container) {
    render(null, container);
    container.remove();
  }
});

afterAll(() => restoreDomGlobals());

describe('speech autoplay', () => {
  test('speaks the settled run once', async () => {
    const spoken: Array<{ text: string; key: string }> = [];
    const speak = (text: string, key: string) => spoken.push({ text, key });
    const stop = () => {};

    await mount(true, speak, stop);
    settle(false, speak, stop);

    expect(spoken).toEqual([{ text: 'the answer', key: 'a1' }]);

    // A later render of the same settled history is not a second run.
    settle(false, speak, stop);
    expect(spoken).toHaveLength(1);
  });

  test('mounting on settled history says nothing', async () => {
    const spoken: string[] = [];
    await mount(false, (_text, key) => spoken.push(key), () => {});
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(spoken).toEqual([]);
  });

  test('the setting off keeps it silent', async () => {
    primeKabmoSettings({ tts: { ...DEFAULT_TTS_CONFIG, autoplay: false } });
    const spoken: string[] = [];
    const speak = (_text: string, key: string) => spoken.push(key);

    await mount(true, speak, () => {});
    await settle(false, speak, () => {});
    expect(spoken).toEqual([]);
  });

  test('speaks only the run’s last answer, not the interim lines', async () => {
    const run: ChatMessageData[] = [
      { id: 'u1', role: 'user', content: 'question' },
      { id: 'a1', role: 'ai', content: 'let me check the file' },
      { id: 'a2', role: 'ai', content: 'running the tests' },
      { id: 'a3', role: 'ai', content: 'the final answer' },
    ];
    const spoken: Array<{ text: string; key: string }> = [];
    const speak = (text: string, key: string) => spoken.push({ text, key });

    await mount(true, speak, () => {}, run);
    settle(false, speak, () => {}, run);

    expect(spoken).toEqual([{ text: 'the final answer', key: 'a3' }]);
  });

  test('a new turn stops the previous playback', async () => {
    let stops = 0;
    const speak = () => {};
    const stop = () => { stops += 1; };

    await mount(true, speak, stop);
    settle(false, speak, stop);
    const afterSettle = stops;
    // A new turn (generating again) stops whatever the settled run started.
    settle(true, speak, stop);
    expect(stops).toBeGreaterThan(afterSettle);
  });
});
