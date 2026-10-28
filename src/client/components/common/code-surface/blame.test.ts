/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The blame labels and the card's interaction, mounted on a real editor view.
 *
 * Everything here is a DOM fact rather than a state assertion, because that is
 * where this feature fails: a `Decoration.widget` at the wrong offset renders
 * (the label just sits on the wrong line), a plugin that never rebuilds on a
 * viewport change renders labels for the lines the reader scrolled away from,
 * and an interaction that closes on the wrong event either makes the card
 * impossible to select or leaves it on screen over a different file.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { BlamePayload } from '@/shared/lib/fs/git-blame';
import type { BlameSnapshot, BlameHistoryResult, FileBlame } from '@/client/hooks/editor/blame';
import { blameExtensions } from '@/client/components/common/code-surface/blame';
import { surfaceExtensions } from '@/client/components/common/code-surface/extensions';
import { SHIKI_THEMES } from '@/shared/lib/code/shiki-themes';

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const PAYLOAD: BlamePayload = {
  available: true,
  head: SHA,
  lines: 6,
  runs: [
    { from: 1, to: 3, sha: SHA },
    { from: 4, to: 6, sha: OTHER },
  ],
  commits: {
    [SHA]: { sha: SHA, author: 'Ada Lovelace', mail: 'ada@example.com', time: 1_700_000_000, summary: 'feat: open' },
    [OTHER]: { sha: OTHER, author: 'Grace Hopper', mail: 'grace@example.com', time: 1_690_000_000, summary: 'fix: bug' },
  },
};

const DOC = 'one\ntwo\nthree\nfour\nfive\nsix\n';

interface FakeController {
  controller: FileBlame;
  /** Replace the answer the labels read, and notify — the controller's own path. */
  publish(snapshot: BlameSnapshot): void;
  readonly calls: number[];
}

function fakeController(
  initial: BlameSnapshot,
  options: { stale?: boolean; history?: BlameHistoryResult } = {},
): FakeController {
  const listeners = new Set<() => void>();
  const calls: number[] = [];
  let current = initial;
  const controller: FileBlame = {
    ensure: () => {},
    reload: () => {},
    history: async (line) => {
      calls.push(line);
      return options.history ?? { entries: [], truncated: false };
    },
    snapshot: () => current,
    stale: () => options.stale === true,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    controller,
    publish(next) {
      current = next;
      for (const listener of listeners) listener();
    },
    get calls() {
      return calls;
    },
  };
}

/**
 * Globals CM6's view needs and happy-dom does not install on `globalThis`.
 * `fold-stack.test.ts` carries the same list for the same reason: the view
 * mounts a `MutationObserver` in its constructor.
 */
const EXTRA_GLOBALS = ['MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;
const nativeGlobals: Partial<Record<(typeof EXTRA_GLOBALS)[number], unknown>> = {};

let host: HTMLElement;
let view: EditorView | null = null;

let fake: FakeController | null = null;

function mount(snapshot: BlameSnapshot, options: { compact?: boolean } = {}): EditorView {
  fake = fakeController(snapshot);
  view = new EditorView({
    state: EditorState.create({
      doc: DOC,
      extensions: [blameExtensions({ controller: fake.controller, compact: options.compact })],
    }),
    parent: host,
  });
  return view;
}

function labels(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.cm-blame-label')];
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  host = document.body.appendChild(document.createElement('div'));
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of EXTRA_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
  restoreDomGlobals();
});

beforeEach(() => {
  view?.destroy();
  view = null;
  host.replaceChildren();
  for (const card of document.querySelectorAll('[aria-label="Line blame"]')) card.remove();
});

describe('blame labels', () => {
  test('one label per run, on the run’s FIRST line', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    const rendered = labels();
    expect(rendered).toHaveLength(2);
    expect(rendered[0].dataset.blameLine).toBe('1');
    expect(rendered[1].dataset.blameLine).toBe('4');
  });

  test('the label names the author and carries the subject as its title', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    const [first, second] = labels();
    expect(first.textContent).toContain('Ada Lovelace');
    expect(first.title).toBe('feat: open');
    expect(second.textContent).toContain('Grace Hopper');
  });

  test('compact mode drops the age, for a narrow panel', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null }, { compact: true });
    expect(labels()[0].textContent).toBe('Ada Lovelace');
  });

  test('an uncommitted run wears no label at all', () => {
    const uncommitted = '0'.repeat(40);
    mount({
      status: 'ready',
      message: null,
      payload: {
        ...PAYLOAD,
        runs: [{ from: 1, to: 6, sha: uncommitted }],
        commits: { [uncommitted]: { sha: uncommitted, author: 'Not Committed Yet', mail: '', time: 0, summary: '' } },
      },
    });
    expect(labels()).toHaveLength(0);
  });

  test('an edit drops the labels until a NEW payload arrives', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    expect(labels().length).toBeGreaterThan(0);
    view!.dispatch({ changes: { from: 0, insert: 'zero\n' } });
    // Every line number after the edit now names a different line.
    expect(labels()).toHaveLength(0);

    // A cache HIT hands back the same object, which cannot describe the edit.
    fake!.publish({ status: 'ready', payload: PAYLOAD, message: null });
    expect(labels()).toHaveLength(0);

    // A new answer does describe it: the bridge dispatches it, so the DOM
    // follows with no transaction from the caller.
    fake!.publish({ status: 'ready', payload: { ...PAYLOAD, lines: 7 }, message: null });
    expect(labels().length).toBeGreaterThan(0);
  });

  test('an unavailable payload draws nothing rather than empty labels', () => {
    mount({
      status: 'unavailable',
      message: null,
      payload: { available: false, head: null, lines: 0, runs: [], commits: {}, reason: 'untracked' },
    });
    expect(labels()).toHaveLength(0);
  });
});

describe('the gutter target, on the real extension stack', () => {
  test('a hover on a line number opens the card for that line', () => {
    // The gutter only exists because `lineNumbers()` is installed, so this
    // mounts the component's own stack rather than the blame extensions alone —
    // the same reason `fold-stack.test.ts` mounts it for `foldGutter`.
    const { controller } = fakeController({ status: 'ready', payload: PAYLOAD, message: null });
    view = new EditorView({
      state: EditorState.create({
        doc: DOC,
        extensions: surfaceExtensions({
          language: 'typescript',
          wordWrapCompartment: new Compartment(),
          readOnlyCompartment: new Compartment(),
          themeCompartment: new Compartment(),
          languageCompartment: new Compartment(),
          indentCompartment: new Compartment(),
          typingCompartment: new Compartment(),
          blameCompartment: new Compartment(),
          blame: blameExtensions({ controller }),
          wordWrap: false,
          readOnly: false,
          themes: SHIKI_THEMES,
          indentUnitText: '  ',
          typing: { autoCloseBrackets: false, autocomplete: false },
          onDocChange: () => {},
          onState: () => {},
        }),
      }),
      parent: host,
    });

    const gutters = host.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement');
    expect(gutters.length).toBeGreaterThan(0);
    // The first row is line 1; the second is line 2, inside the first run.
    gutters[1].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')?.textContent).toContain('Ada Lovelace');
  });
});

describe('the blame card', () => {
  test('a hover on a label opens the card for that line', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    const target = labels()[1];
    target.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));

    const card = document.querySelector<HTMLElement>('[aria-label="Line blame"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain('Grace Hopper');
  });

  test('a press on a label opens it too, which is the phone’s only path', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')?.textContent).toContain('Ada Lovelace');
  });


  test('a press outside the card closes it', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')).not.toBeNull();

    document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')).toBeNull();
  });

  test('a press inside the card leaves it open, so its text can be selected', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    const card = document.querySelector<HTMLElement>('[aria-label="Line blame"]')!;

    card.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')).not.toBeNull();
  });

  test('Escape closes it', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[aria-label="Line blame"]')).toBeNull();
  });

  test('an edit closes it: the line it named has moved', () => {
    mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    view!.dispatch({ changes: { from: 0, insert: 'x' } });
    expect(document.querySelector('[aria-label="Line blame"]')).toBeNull();
  });

  test('destroying the view removes the card it opened', () => {
    const mounted = mount({ status: 'ready', payload: PAYLOAD, message: null });
    labels()[0].dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true }));
    mounted.destroy();
    view = null;
    expect(document.querySelector('[aria-label="Line blame"]')).toBeNull();
  });
});
