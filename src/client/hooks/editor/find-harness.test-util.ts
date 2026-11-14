/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The harness `use-editor-find` is exercised through.
 *
 * Split out because the find hook has two test files (opening and stepping /
 * writing and options) and both must render it the same way — the session
 * provider it needs, the surface calls it makes, and a fresh session id per test
 * so the PERSISTED query does not leak between them.
 *
 * The hook's modules are imported dynamically, after the DOM globals exist:
 * Preact binds its environment at evaluation time, and a static import would
 * capture the DOM-less one.
 */

import { afterAll, afterEach, beforeAll, beforeEach } from 'bun:test';
import { Window } from 'happy-dom';
import type { ComponentChildren, h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { EditorFindState, useEditorFind as UseEditorFindHook } from '@/client/hooks/editor/use-editor-find';

export interface FindHarness {
  /** The latest render's state; re-read after every settle, never held across one. */
  readonly find: EditorFindState | null;
  /** What the hook under test is handed — mutated per test, then re-rendered. */
  readonly input: {
    text: string;
    documentKey: string;
    selection: { start: number; end: number } | null;
  };
  /** Surface calls, so "did it select / reveal / write" is observable. */
  readonly selections: Array<[number, number, boolean]>;
  readonly reveals: number[];
  readonly writes: Array<{ value: string; caretStart: number }>;
  /** Re-render with the current `input` and settle. */
  rerender: () => Promise<void>;
  /** Flush pending effects and renders. */
  flush: () => Promise<void>;
  /**
   * Preact's `act`, exposed because every interaction in these tests is a hook
   * call the DOM never sees: it has to be wrapped to be flushed.
   */
  act: typeof PreactAct;
  /** Register the before/after hooks this harness needs. */
  install: () => void;
}

/**
 * A session id no other harness in this RUN will mint.
 *
 * The query and the toggles persist per session id into a module singleton
 * (`shared/lib/workspace/session-state`), and TWO files share this harness
 * (`use-editor-find.test.ts`, `use-editor-find-write.test.ts`). A per-file
 * counter restarts at 1, so the second file's `test-session-2` read the first
 * file's persisted `alpha` back — measured on the Ubuntu gate, where the case
 * that seeds nothing failed with `Received: "alpha"`. Bun shares the module
 * registry across test files, so the counter has to be shared too.
 */
function nextSessionId(): string {
  const target = globalThis as unknown as Record<string, unknown>;
  const next = (typeof target.__kabmoFindHarnessSessions === 'number' ? target.__kabmoFindHarnessSessions : 0) + 1;
  target.__kabmoFindHarnessSessions = next;
  return `find-harness-session-${next}`;
}

export async function createFindHarness(): Promise<FindHarness> {
  let useEditorFind: typeof UseEditorFindHook;
  let SessionStateContext: { Provider: (props: { value: { sessionId: string; ready: boolean }; children: ComponentChildren }) => ComponentChildren };
  let h: typeof PreactH;
  let render: typeof PreactRender;
  let act: typeof PreactAct;

  let find: EditorFindState | null = null;
  let container: HTMLElement;
  let sessionId = 'test-session';

  const input: FindHarness['input'] = { text: 'alpha beta alpha', documentKey: 'file-1', selection: { start: 0, end: 5 } };
  const selections: FindHarness['selections'] = [];
  const reveals: number[] = [];
  const writes: FindHarness['writes'] = [];

  function Inner() {
    find = useEditorFind({
      text: input.text,
      documentKey: input.documentKey,
      readSelection: () => input.selection,
      select: (start, end, focus = true) => selections.push([start, end, focus]),
      reveal: (offset) => reveals.push(offset),
      applyDocument: (value, caretStart) => writes.push({ value, caretStart }),
    });
    return null;
  }

  function Harness() {
    // The hook persists the query and the toggles per session, so it needs the
    // provider the panel supplies. A test session id is all it reads.
    return h(SessionStateContext.Provider, { value: { sessionId, ready: true }, children: h(Inner, {}) });
  }

  async function flush() {
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        for (let turn = 0; turn < 4; turn++) await Promise.resolve();
      });
    }
  }

  async function rerender() {
    await act(async () => {
      render(h(Harness, {}), container);
    });
    await flush();
  }

  const domGlobals = (win: Window): Record<string, unknown> => ({
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
  });

  const installed: Record<string, unknown> = {};
  const displaced: Record<string, unknown> = {};

  return {
    get find() {
      return find;
    },
    input,
    selections,
    reveals,
    writes,
    rerender,
    flush,
    get act() {
      return act;
    },
    install() {
      beforeAll(async () => {
        const win = new Window({ url: 'http://localhost' });
        for (const [key, value] of Object.entries(domGlobals(win))) {
          displaced[key] = (globalThis as Record<string, unknown>)[key];
          installed[key] = value;
          (globalThis as Record<string, unknown>)[key] = value;
        }
        ({ useEditorFind } = await import('@/client/hooks/editor/use-editor-find'));
        ({ SessionStateContext } = await import('@/client/hooks/workspace/session-state/context'));
        ({ h, render } = await import('preact'));
        ({ act } = await import('preact/test-utils'));
      });

      afterAll(() => {
        for (const key of Object.keys(installed)) {
          if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
          else (globalThis as Record<string, unknown>)[key] = displaced[key];
        }
      });

      beforeEach(async () => {
        find = null;
        // The query and the toggles are persisted per session — that is the
        // feature — so each test gets its OWN session id rather than sharing a
        // blob with the test before it (or with the other file's harness).
        sessionId = nextSessionId();
        input.text = 'alpha beta alpha';
        input.documentKey = 'file-1';
        input.selection = { start: 0, end: 5 };
        selections.length = 0;
        reveals.length = 0;
        writes.length = 0;
        container = document.createElement('div');
        document.body.appendChild(container);
        await rerender();
      });

      afterEach(() => {
        render(null, container);
        container.remove();
      });
    },
  };
}
