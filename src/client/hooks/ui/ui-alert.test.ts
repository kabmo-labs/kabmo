/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The waiting-session alert: cues only newly-waiting sessions — a question
 * already waiting at page load is not news, and the same snapshot twice cues
 * once. Split verbatim from `ui-sounds.test.ts` so both files stay under the
 * repo's 350-line ceiling; the shared synth/DOM fakes ride along because the
 * file must stand alone. */

import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useInputRequiredAlert } from '@/client/hooks/ui/input-required-alert';
import { primeKabmoSettings } from '@/shared/lib/settings/client';
import type { WorkspaceFolderData } from '@/shared/types';

const DOM_GLOBALS = ['window', 'document', 'navigator'] as const;
/** The runner's own globals, restored on teardown (see the matching afterAll at the end of this file) so later files still see native Event/CustomEvent/window. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement | undefined;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  container = undefined;
  jest.useRealTimers();
  FakeAudioContext.instances.length = 0;
  (win as unknown as Record<string, unknown>).AudioContext = FakeAudioContext;
});

function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  act(() => {
    render(vnode, container as HTMLElement);
  });
}

/** The alert mounts the real hook, so every constructed context is a cue. */

/** The synth surface the sound hooks touch, recorded instead of played. */
class FakeParam {
  readonly events: Array<[string, number, number]> = [];
  setValueAtTime(value: number, time: number) {
    this.events.push(['set', value, time]);
    return this;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push(['linear', value, time]);
    return this;
  }
  exponentialRampToValueAtTime(value: number, time: number) {
    this.events.push(['exp', value, time]);
    return this;
  }
}

class FakeOscillator {
  type = '';
  readonly frequency = new FakeParam();
  readonly started: number[] = [];
  readonly stopped: number[] = [];
  readonly connections: unknown[] = [];
  connect(node: unknown) {
    this.connections.push(node);
  }
  start(time: number) {
    this.started.push(time);
  }
  stop(time: number) {
    this.stopped.push(time);
  }
}

class FakeGain {
  readonly gain = new FakeParam();
  readonly connections: unknown[] = [];
  connect(node: unknown) {
    this.connections.push(node);
  }
}

class FakeAudioContext {
  static readonly instances: FakeAudioContext[] = [];
  state: 'suspended' | 'running' = 'suspended';
  readonly currentTime = 0;
  readonly destination = { name: 'destination' };
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  resumes = 0;
  closes = 0;
  constructor() {
    FakeAudioContext.instances.push(this);
  }
  resume() {
    this.resumes += 1;
    return Promise.resolve();
  }
  close() {
    this.closes += 1;
    return Promise.resolve();
  }
  createOscillator() {
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }
  createGain() {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
}

/** The single context the last cue built. */

function folderWith(sessions: Array<{ id: string; awaitingInput?: boolean }>): WorkspaceFolderData[] {
  return [
    {
      id: 1,
      name: 'workspace',
      isExpanded: true,
      hasMore: false,
      totalSessions: sessions.length,
      sessions: sessions.map((session) => ({
        id: session.id,
        folder_id: 1,
        title: session.id,
        awaitingInput: session.awaitingInput,
      })),
    },
  ];
}

function AlertProbe({ folders }: { folders: WorkspaceFolderData[] }) {
  useInputRequiredAlert(folders);
  return h('span', null, String(folders.length));
}

/** Cues are observed as constructed audio contexts. */
function cues(): number {
  return FakeAudioContext.instances.length;
}

describe('useInputRequiredAlert', () => {
  test('does not replay a cue for questions already waiting at page load', () => {
    primeKabmoSettings({ chatCompletionSound: true });
    mount(h(AlertProbe, { folders: folderWith([{ id: 'a', awaitingInput: true }]) }));
    expect(cues()).toBe(0);
  });

  test('fires exactly one cue when a session newly starts waiting', () => {
    primeKabmoSettings({ chatCompletionSound: true });
    mount(h(AlertProbe, { folders: folderWith([{ id: 'a' }]) }));
    expect(cues()).toBe(0);

    act(() => {
      render(
        h(AlertProbe, { folders: folderWith([{ id: 'a' }, { id: 'b', awaitingInput: true }]) }),
        container as HTMLElement,
      );
    });
    expect(cues()).toBe(1);

    // The same waiting session is not news on the next snapshot.
    act(() => {
      render(h(AlertProbe, { folders: folderWith([{ id: 'a' }, { id: 'b', awaitingInput: true }]) }), container as HTMLElement);
    });
    expect(cues()).toBe(1);
  });

  test('several newly waiting sessions still cue only once', () => {
    primeKabmoSettings({ chatCompletionSound: true });
    mount(h(AlertProbe, { folders: folderWith([]) }));

    act(() => {
      render(
        h(AlertProbe, {
          folders: folderWith([
            { id: 'a', awaitingInput: true },
            { id: 'b', awaitingInput: true },
            { id: 'c', awaitingInput: true },
          ]),
        }),
        container as HTMLElement,
      );
    });
    expect(cues()).toBe(1);
  });

  test('a session that stops waiting and waits again is news', () => {
    primeKabmoSettings({ chatCompletionSound: true });
    mount(h(AlertProbe, { folders: folderWith([{ id: 'a', awaitingInput: true }]) }));

    act(() => {
      render(h(AlertProbe, { folders: folderWith([{ id: 'a' }]) }), container as HTMLElement);
    });
    act(() => {
      render(h(AlertProbe, { folders: folderWith([{ id: 'a', awaitingInput: true }]) }), container as HTMLElement);
    });
    expect(cues()).toBe(1);
  });

  test('the cue respects the notification preference', () => {
    primeKabmoSettings({ chatCompletionSound: false });
    mount(h(AlertProbe, { folders: folderWith([]) }));

    act(() => {
      render(h(AlertProbe, { folders: folderWith([{ id: 'a', awaitingInput: true }]) }), container as HTMLElement);
    });
    expect(cues()).toBe(0);
  });
});

afterAll(() => {
  primeKabmoSettings({});
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});
