/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shared mount for `useFileEditor`'s specs: the DOM globals it needs, the
 * fetch stub, and the settle/act helpers.
 *
 * Extracted because the hook's contract now spans two files — the read/refresh
 * half and the write half (autosave, Save, the deleted-file confirmation) — and
 * a second copy of this harness would drift on the two things that make it
 * work: the stub must answer BOTH `/api/fs/read` and `/api/fs/action`, and the
 * globals must go back the way they were, because every test file in this
 * repository shares one process.
 */

import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type {
  UseFileEditorOptions,
  UseFileEditorResult,
  useFileEditor as UseFileEditorHook,
} from '@/client/hooks/editor/use-file-editor';

export const DISK = 'const a = 1;\nconst b = 2;\n';
/** Stable identity: the read effect re-runs when its target object changes. */
export const TARGET = { id: 1, name: 'a.js', path: 'a.js' };

export interface FsState {
  reads: number;
  writes: number;
  body: string;
  /** The `eol` field of the last write — the ending the server is asked to use. */
  sentEol: string | null;
  /**
   * When set, a read is answered with this refusal instead of `body` — the
   * shape `/api/fs/read` returns for a file it will not hand back as text.
   */
  readRefusal: { status: number; error: string; kind?: 'binary' | 'too-large' } | null;
}

/** Serves `state.body` for reads and records writes, without touching the network. */
export function stubFetch(state: FsState) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith('/api/fs/read')) {
      state.reads += 1;
      if (state.readRefusal) {
        const { status, error, kind } = state.readRefusal;
        return { ok: false, status, json: async () => ({ error, kind }) };
      }
      return { ok: true, status: 200, json: async () => ({ content: state.body }) };
    }
    const form = init?.body as FormData;
    state.writes += 1;
    state.body = String(form.get('content'));
    state.sentEol = form.get('eol') === null ? null : String(form.get('eol'));
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }) as unknown as typeof fetch;
}

/** A fresh per-test state. */
export function freshState(body: string = DISK): FsState {
  return { reads: 0, writes: 0, sentEol: null, body, readRefusal: null };
}

/**
 * Runs the debounce immediately for the duration of `body`.
 *
 * The autosave is a `window.setTimeout(…, 800)`; the settle helper flushes
 * microtasks, not timers, so a test that merely awaits would report "no write"
 * whether or not the guard exists. Firing the timer on schedule makes the
 * assertion about the GUARD rather than about the clock.
 */
export async function withImmediateTimers(body: () => Promise<void>) {
  const realTimeout = window.setTimeout;
  const realClear = window.clearTimeout;
  window.setTimeout = ((handler: () => void) => {
    handler();
    return 0;
  }) as typeof window.setTimeout;
  window.clearTimeout = (() => {}) as typeof window.clearTimeout;
  try {
    await body();
  } finally {
    window.setTimeout = realTimeout;
    window.clearTimeout = realClear;
  }
}

export interface EditorHarness {
  /** Latest render's result — re-read after every settle, never held across one. */
  readonly mounted: UseFileEditorResult | null;
  settle(): Promise<void>;
  mount(target?: typeof TARGET, options?: UseFileEditorOptions): Promise<void>;
  /** Run a state update inside Preact's `act`, then settle. */
  run(update: () => void): Promise<void>;
}

/**
 * Installs the DOM globals, imports the hook and Preact, and registers the
 * lifecycle hooks. Call once at a spec file's top level, before any `describe`.
 */
export function createEditorHarness(): EditorHarness {
  let useFileEditor: typeof UseFileEditorHook;
  let h: typeof PreactH;
  let render: typeof PreactRender;
  let act: typeof PreactAct;

  let mounted: UseFileEditorResult | null = null;
  let container: HTMLElement;

  async function settle() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await act(async () => {
      for (let i = 0; i < 20; i++) await Promise.resolve();
    });
  }

  async function mount(target: typeof TARGET = TARGET, options: UseFileEditorOptions = {}) {
    const Probe = () => {
      mounted = useFileEditor(target, options);
      return null;
    };
    await act(async () => {
      render(h(Probe, {}), container);
    });
    await settle();
  }

  const nativeFetch = Bun.fetch;

  beforeAll(async () => {
    const win = new Window({ url: 'http://localhost' });
    installDomGlobals(win);
    ({ useFileEditor } = await import('@/client/hooks/editor/use-file-editor'));
    ({ h, render } = await import('preact'));
    ({ act } = await import('preact/test-utils'));
  });

  // Every test file shares one process, so the globals go back the way they
  // were: code that branches on `typeof window` would otherwise take its
  // browser path for the rest of the run.
  afterAll(() => {
    globalThis.fetch = nativeFetch;
    restoreDomGlobals();
  });

  beforeEach(() => {
    mounted = null;
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  // Unmount while the DOM globals still exist, so the hook's effect cleanups
  // run here. A landed save arms a timer that returns the status to `idle`; an
  // effect timer that outlived this file would fire during the next file's test
  // and, with `window` already removed by `afterAll`, break its render.
  afterEach(() => {
    if (container) render(null, container);
    container?.remove();
  });

  async function run(update: () => void) {
    await act(async () => {
      update();
    });
    await settle();
  }

  return {
    get mounted() {
      return mounted;
    },
    settle,
    mount,
    run,
  };
}
