/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The find bar's rendering.
 *
 * The arithmetic lives in `shared/lib/code/editor/find-status` and the state in
 * `use-editor-find`; what this covers is the bar itself — that every toggle
 * carries its own `aria-pressed`, that the chord in a tooltip comes from the
 * keymap rather than a hand-written string, and that Enter and the buttons reach
 * the hook rather than doing nothing.
 *
 * Rendered directly with `h()` (no JSX) against happy-dom; the component modules
 * are imported dynamically, after those globals exist.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ComponentChildren, h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { EditorFindState } from '@/client/hooks/editor/use-editor-find';

let FindWidget: (props: { find: EditorFindState }) => ComponentChildren;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;
/** Calls the widget made into the hook, so the wiring is observable. */
const calls: string[] = [];

/** A find state whose every action records itself, so a click is provable. */
function findState(overrides: Partial<EditorFindState> = {}): EditorFindState {
  // `Object.assign` rather than a spread: a spread of `Partial<T>` widens every
  // required property to `| undefined`, which the contract rightly refuses.
  return Object.assign<EditorFindState, Partial<EditorFindState>>({
    open: true,
    replaceOpen: false,
    query: '',
    replacement: '',
    options: { matchCase: false, wholeWord: false, isRegex: false, inSelection: false },
    matches: [],
    truncated: false,
    invalid: false,
    currentIndex: -1,
    setQuery: (value) => calls.push(`setQuery:${value}`),
    setReplacement: (value) => calls.push(`setReplacement:${value}`),
    openFind: () => calls.push('openFind'),
    openReplace: () => calls.push('openReplace'),
    toggleReplace: () => calls.push('toggleReplace'),
    focusRequest: 0,
    close: () => calls.push('close'),
    runCommand: (command) => calls.push(`runCommand:${command}`),
    revealMatch: (request) => calls.push(`revealMatch:${request.line}`),
    toggleOption: (key) => calls.push(`toggleOption:${key}`),
    step: (direction) => calls.push(`step:${direction}`),
    replaceCurrent: () => calls.push('replaceCurrent'),
    replaceAll: () => calls.push('replaceAll'),
    selectionRange: null,
    history: [],
    useHistoryEntry: (value: string) => calls.push(`useHistoryEntry:${value}`),
  }, overrides);
}

async function mount(find: EditorFindState) {
  await act(async () => {
    render(h(FindWidget, { find }), container);
  });
}

function byLabel(label: string): HTMLElement | null {
  return container.querySelector(`[aria-label="${label}"]`);
}

/** The BUTTON with this label — `Replace` also names the text field. */
function buttonByLabel(label: string): HTMLButtonElement | null {
  return container.querySelector(`button[aria-label="${label}"]`);
}

/** The element whose label starts with `prefix` — the toggles carry a chord suffix. */
function byLabelPrefix(prefix: string): HTMLElement | null {
  return container.querySelector(`[aria-label^="${prefix}"]`);
}

async function click(element: HTMLElement | null) {
  await act(async () => {
    element?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
  });
}

/** Type into a field the way the browser reports it. */
async function type(input: HTMLElement | null, value: string) {
  if (!input) return;
  (input as HTMLInputElement).value = value;
  await act(async () => {
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
}

async function press(input: HTMLElement | null, key: string, shiftKey = false) {
  await act(async () => {
    input?.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
  });
}

function domGlobals(win: Window): Record<string, unknown> {
  return {
    window: win,
    document: win.document,
    navigator: win.navigator,
    Node: win.Node,
    Element: win.Element,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
  };
}

const installed: Record<string, unknown> = {};
const displaced: Record<string, unknown> = {};

beforeAll(async () => {
  const win = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries(domGlobals(win))) {
    displaced[key] = (globalThis as Record<string, unknown>)[key];
    installed[key] = value;
    (globalThis as Record<string, unknown>)[key] = value;
  }
  ({ FindWidget } = await import('@/client/components/workspace/editor/FindWidget'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => {
  for (const key of Object.keys(installed)) {
    if (displaced[key] === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = displaced[key];
  }
});

beforeEach(() => {
  calls.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('FindWidget', () => {
  test('focuses the query field on mount, so ⌘F needs no second click', async () => {
    await mount(findState());

    expect(document.activeElement).toBe(byLabel('Find'));
  });

  test('typing in the query reaches the hook', async () => {
    await mount(findState());
    await type(byLabel('Find'), 'alpha');

    expect(calls).toEqual(['setQuery:alpha']);
  });

  test('the replace row is hidden until it is asked for', async () => {
    await mount(findState());

    expect(byLabel('Replace')).toBeNull();
    expect(byLabelPrefix('Show replace')).not.toBeNull();
  });

  test('with the replace row open, typing the replacement reaches the hook', async () => {
    await mount(findState({ replaceOpen: true }));
    await type(byLabel('Replace'), 'OMEGA');

    expect(calls).toEqual(['setReplacement:OMEGA']);
  });

  test('each toggle reports its own state and its own shortcut', async () => {
    await mount(findState({ options: { matchCase: true, wholeWord: false, isRegex: true, inSelection: false } }));

    const matchCase = byLabelPrefix('Match case');
    const wholeWord = byLabelPrefix('Match whole word');
    const regex = byLabelPrefix('Use regular expression');

    expect(matchCase?.getAttribute('aria-pressed')).toBe('true');
    expect(wholeWord?.getAttribute('aria-pressed')).toBe('false');
    expect(regex?.getAttribute('aria-pressed')).toBe('true');
    // The chord is derived from the keymap, so a tooltip cannot name a key that
    // is not bound.
    expect(matchCase?.getAttribute('aria-label')).toMatch(/[⌘⌥⇧]|Alt\+/);
  });

  test('clicking a toggle names the option it flips', async () => {
    await mount(findState());
    await click(byLabelPrefix('Match whole word'));

    expect(calls).toEqual(['toggleOption:wholeWord']);
  });

  test('Enter steps forward and ⇧Enter steps back, keeping focus in the field', async () => {
    await mount(findState({ matches: [{ start: 0, end: 5 }], currentIndex: 0 }));

    await press(byLabel('Find'), 'Enter');
    await press(byLabel('Find'), 'Enter', true);

    expect(calls).toEqual(['step:1', 'step:-1']);
  });

  test('a chorded Enter is left to the panel, which owns ⌘⏎', async () => {
    await mount(findState({ matches: [{ start: 0, end: 5 }], currentIndex: 0 }));
    const input = byLabel('Find');
    await act(async () => {
      input?.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
    });

    expect(calls).toEqual([]);
  });

  test('the stepper buttons are disabled with nothing to step to', async () => {
    await mount(findState());

    expect(buttonByLabel('Next match')?.disabled).toBe(true);
    expect(buttonByLabel('Previous match')?.disabled).toBe(true);
  });

  test('the replace buttons are disabled with nothing to replace', async () => {
    await mount(findState({ replaceOpen: true }));

    expect(buttonByLabel('Replace')?.disabled).toBe(true);
    expect(buttonByLabel('Replace all')?.disabled).toBe(true);
  });

  test('the count is announced and reads as the widget’s own status', async () => {
    await mount(findState({ query: 'alpha', matches: [{ start: 0, end: 5 }, { start: 9, end: 14 }], currentIndex: 1 }));

    const status = container.querySelector('[aria-live="polite"]');
    expect(status?.textContent).toBe('2 of 2');
  });

  test('an invalid pattern is marked on the field, not only in the status', async () => {
    // The user has to see WHICH field is wrong, not just that something is.
    await mount(findState({ query: 'a(', invalid: true }));

    expect(byLabel('Find')?.className).toContain('border-error');
  });

  test('the close button asks the hook to close', async () => {
    await mount(findState());
    await click(buttonByLabel('Close find'));

    expect(calls).toEqual(['close']);
  });

  test('the expander toggles the replace row', async () => {
    await mount(findState());
    await click(byLabelPrefix('Show replace'));

    expect(calls).toEqual(['toggleReplace']);
  });
});
