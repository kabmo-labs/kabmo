/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * `useSessionValue` and the components that read the same slot.
 *
 * The defect this pins: the hook read the store ONCE per mount and then held a
 * private copy, so two components reading one key never saw each other's
 * writes. A field that WRITES a value and a readout that DISPLAYS it therefore
 * disagreed permanently — the readout kept whatever it read at mount while the
 * field showed what the user had typed. That is the bundled example plugin's
 * own shape (a note field and a character count of that note), so the plugin
 * contradicted itself on screen.
 *
 * Two rules the fix must keep:
 *
 * - a write by ANOTHER component re-reads the slot and re-renders;
 * - a write by THIS component does NOT: its own state is the newer truth until
 *   the debounce lands, and re-reading would fight the user's keystrokes.
 *
 * Rendered with `h()` (no JSX) against happy-dom, with a fake services seam —
 * the kit is a published package and must not reach into the host's source.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, useSessionValue, type PanelContext, type UiKitServices } from '@kabmo-labs/ui';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement', 'Event', 'MouseEvent', 'KeyboardEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

const CONTEXT: PanelContext = { sessionId: 's1', workspacePath: '/ws', theme: 'paper' };

/** The store behind the fake seam: one slot per session+key, as the host has. */
function makeServices() {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<() => void>>();
  const slotKey = (key: string) => `${CONTEXT.sessionId}:${key}`;

  const services: UiKitServices = {
    context: () => CONTEXT,
    subscribe: () => () => {},
    getSessionValue: (_sessionId, key) => store.get(slotKey(key)) ?? null,
    setSessionValue: (_sessionId, key, value) => {
      store.set(slotKey(key), value);
      for (const listener of [...(listeners.get(slotKey(key)) ?? [])]) listener();
    },
    subscribeSessionValue: (_sessionId, key, listener) => {
      const bucket = listeners.get(slotKey(key)) ?? new Set();
      bucket.add(listener);
      listeners.set(slotKey(key), bucket);
      return () => bucket.delete(listener);
    },
    readWorkspaceFile: async () => '',
  };

  /** What a DIFFERENT component's write looks like, reaching every reader. */
  const externalWrite = (key: string, value: string) => services.setSessionValue(CONTEXT.sessionId, key, value);

  return { services, store, externalWrite };
}

let container: HTMLElement;

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
});

afterEach(() => {
  render(null, container);
  container.remove();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

describe('useSessionValue', () => {
  test('a readout follows a write made by ANOTHER component', async () => {
    const { services, externalWrite } = makeServices();
    configureUiKit(services);

    /** Reads the slot without ever writing it — the readout's shape. */
    function Readout() {
      const { value } = useSessionValue('note', 10);
      return h('span', { id: 'readout' }, String((value ?? '').length));
    }

    await act(async () => {
      render(h(Readout, {}), container);
    });
    expect(container.textContent).toBe('0');

    // The field component writes; the readout must catch up.
    await act(async () => {
      externalWrite('note', 'hello');
    });
    expect(container.textContent).toBe('5');
  });

  test('a component mid-edit keeps its own text until the debounce lands', async () => {
    const { services } = makeServices();
    configureUiKit(services);

    function Field() {
      const { value, update } = useSessionValue('note', 10_000);
      return h('input', { id: 'field', value: value ?? '', onInput: (event: Event) => update((event.target as HTMLInputElement).value) });
    }

    await act(async () => {
      render(h(Field, {}), container);
    });

    const field = container.querySelector('#field') as HTMLInputElement;
    await act(async () => {
      field.value = 'typed';
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // A long debounce: the store still holds nothing, and the field must NOT
    // re-read it — that would erase the keystroke on screen.
    expect(field.value).toBe('typed');
  });

  test('a write from another component does not mark this field dirty', async () => {
    const { services, externalWrite, store } = makeServices();
    configureUiKit(services);

    /** A field that would write its value back if an outside write set `saving`. */
    function Field() {
      const { value, update } = useSessionValue('note', 10);
      return h('input', { id: 'field', value: value ?? '', onInput: (event: Event) => update((event.target as HTMLInputElement).value) });
    }

    await act(async () => {
      render(h(Field, {}), container);
    });

    await act(async () => {
      externalWrite('note', 'from elsewhere');
    });

    // The field shows the outside value and has not overwritten it.
    expect((container.querySelector('#field') as HTMLInputElement).value).toBe('from elsewhere');
    const settled = Promise.withResolvers<void>();
    setTimeout(() => settled.resolve(), 40);
    await settled.promise;
    expect(store.get(`${CONTEXT.sessionId}:note`)).toBe('from elsewhere');
  });
});
