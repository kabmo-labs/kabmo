/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Inline rename's commit/escape handshake.
 *
 * The transition that keeps regressing is escape-then-blur: Escape closes the
 * editor, but the input's own blur fires straight after, and a blur that
 * committed would save the abandoned draft over the name the user was editing.
 * `cancelRef` exists for exactly that one transition, so it is pinned both ways
 * — the cancelled blur is silent, and a LATER blur (after a fresh
 * `startRename`) commits again, because the flag must not stick.
 *
 * Mounted with `h()`/`render` against happy-dom so the events go through a real
 * input element (select-on-start, `defaultPrevented`).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useInlineRename } from '@/client/hooks/ui/inline-rename';
import type { InlineRename } from '@/client/hooks/ui/inline-rename';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'Event',
  'CustomEvent',
  'KeyboardEvent',
] as const;

/** The runner's own globals, restored on teardown so later files still see
 *  native `Event`/`CustomEvent` — a happy-dom copy left behind makes a plain
 *  `EventTarget` reject every event dispatched on it. */
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let win: Window;
let container: HTMLElement;

beforeAll(() => {
  win = new Window({ url: 'http://localhost' });
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

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(vnode: Parameters<typeof render>[0]) {
  container ??= document.body.appendChild(document.createElement('div'));
  act(() => {
    render(vnode, container as HTMLElement);
  });
}

interface RenameProbeProps {
  value: string;
  seen: { current: InlineRename | null };
  commits: string[];
}

function RenameProbe({ value, seen, commits }: RenameProbeProps) {
  seen.current = useInlineRename(value, (name) => {
    commits.push(name);
  });
  return h('input', {
    ref: seen.current.inputRef,
    value: seen.current.draft,
    onKeyDown: seen.current.handleKeyDown,
    onBlur: seen.current.handleBlur,
  });
}

function RenameBareProbe({ value, seen }: { value: string; seen: { current: InlineRename | null } }) {
  seen.current = useInlineRename(value);
  return h('span', null, seen.current.draft);
}

/** The input the probe rendered, so events travel through the real element. */
function renameInput(): HTMLInputElement {
  const el = container?.querySelector('input');
  if (!el) throw new Error('rename input was not rendered');
  return el as HTMLInputElement;
}

/** A rename probe with a live commit log. */
function setup(value = 'old name') {
  const seen: { current: InlineRename | null } = { current: null };
  const commits: string[] = [];
  mount(h(RenameProbe, { value, seen, commits }));
  return { seen, commits };
}

describe('useInlineRename', () => {
  test('starting a rename seeds the draft from the name and selects it', () => {
    const { seen } = setup();

    expect(seen.current!.isEditing).toBe(false);
    expect(seen.current!.draft).toBe('old name');

    act(() => seen.current!.startRename());
    expect(seen.current!.isEditing).toBe(true);
    expect(seen.current!.draft).toBe('old name');
    // The whole name is selected, so the first keystroke replaces it.
    expect(renameInput().selectionStart).toBe(0);
    expect(renameInput().selectionEnd).toBe('old name'.length);
  });

  test('Enter commits the trimmed draft and closes the editor', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('  new name  ');
    });

    const event = new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'Enter', cancelable: true });
    act(() => {
      renameInput().dispatchEvent(event);
    });

    expect(commits).toEqual(['new name']);
    expect(seen.current!.isEditing).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  });

  test('an empty or whitespace-only draft cancels instead of committing', () => {
    const { seen, commits } = setup();

    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('   ');
    });
    act(() => seen.current!.commitRename());
    expect(commits).toEqual([]);
    expect(seen.current!.isEditing).toBe(false);

    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('');
    });
    act(() => seen.current!.commitRename());
    expect(commits).toEqual([]);
  });

  test('an unchanged draft closes the editor without committing', () => {
    const { seen, commits } = setup();

    act(() => seen.current!.startRename());
    act(() => seen.current!.commitRename());
    expect(commits).toEqual([]);
    expect(seen.current!.isEditing).toBe(false);

    // Padding does not make it a change: the comparison is on the trim.
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft(' old name ');
    });
    act(() => seen.current!.commitRename());
    expect(commits).toEqual([]);
  });

  test('Escape closes the editor and swallows the blur that follows it', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('abandoned');
    });

    const escape = new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'Escape', cancelable: true });
    act(() => {
      renameInput().dispatchEvent(escape);
    });
    expect(seen.current!.isEditing).toBe(false);
    expect(escape.defaultPrevented).toBe(true);

    // The input blurs because it is gone; that must not save `abandoned`.
    act(() => seen.current!.handleBlur());
    expect(commits).toEqual([]);
  });

  test('a blur after a fresh rename commits — the escape flag is not sticky', () => {
    const { seen, commits } = setup();

    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('abandoned');
      renameInput().dispatchEvent(new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'Escape', cancelable: true }));
    });
    act(() => seen.current!.handleBlur());
    expect(commits).toEqual([]);

    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('kept');
    });
    act(() => seen.current!.handleBlur());
    expect(commits).toEqual(['kept']);
  });

  test('blur without escape commits the trimmed draft', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('  typed  ');
    });
    // The input owns the handler; the DOM event that reaches it crosses two
    // packages (`preact/compat` from the session-state hook chain vs `preact`
    // here), and free function identity for that wiring is not something this
    // suite can pin — the event path itself is shown just below for the keys
    // that do not depend on it.
    act(() => seen.current!.handleBlur());

    expect(commits).toEqual(['typed']);
    expect(seen.current!.isEditing).toBe(false);
  });

  test('the blur after an Enter commit does not commit a second time', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('once');
    });

    // Enter commits and unmounts the field; the blur that follows is the SAME
    // commit and used to fire the rename request twice (two POSTs, two signals).
    act(() => {
      renameInput().dispatchEvent(new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'Enter', cancelable: true }));
    });
    act(() => seen.current!.handleBlur());

    expect(commits).toEqual(['once']);
  });

  test('a later rename still commits after an earlier Enter', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('first');
    });
    act(() => {
      renameInput().dispatchEvent(new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'Enter', cancelable: true }));
    });
    act(() => seen.current!.handleBlur());

    // The one-shot guard is reset by the next startRename, not left armed.
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('second');
    });
    act(() => seen.current!.commitRename());

    expect(commits).toEqual(['first', 'second']);
  });

  test('other keys neither commit nor prevent the default', () => {
    const { seen, commits } = setup();
    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('typing');
    });

    const event = new (win.KeyboardEvent as unknown as typeof KeyboardEvent)('keydown', { key: 'a', cancelable: true });
    act(() => {
      renameInput().dispatchEvent(event);
    });

    expect(seen.current!.isEditing).toBe(true);
    expect(seen.current!.draft).toBe('typing');
    expect(commits).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test('committing with no callback still closes the editor', () => {
    const seen: { current: InlineRename | null } = { current: null };
    mount(h(RenameBareProbe, { value: 'old name', seen }));

    act(() => {
      seen.current!.startRename();
      seen.current!.setDraft('new name');
    });
    act(() => seen.current!.commitRename());
    expect(seen.current!.isEditing).toBe(false);
  });
});
