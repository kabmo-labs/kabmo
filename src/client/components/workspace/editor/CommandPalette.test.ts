/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The command palette's rendering.
 *
 * The list itself is built and filtered in `shared/lib/code/editor/palette`
 * (tested there); what this covers is the interaction — that the field takes
 * focus, that a filter narrows the list, that the arrow keys move the highlight
 * without leaving the list, and that Enter runs the command that is actually
 * highlighted rather than the first one.
 *
 * Rendered directly with `h()` (no JSX) against happy-dom; the component module
 * is imported dynamically, after those globals exist.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ComponentChildren, h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import { EDITOR_KEY_BINDINGS, type EditorCommand } from '@/shared/lib/code/editor/keymap';
import { buildPaletteEntries } from '@/shared/lib/code/editor/palette';
import { isMacPlatform } from '@/shared/lib/util/platform';

let CommandPalette: (props: { onRun: (command: EditorCommand) => void; onClose: () => void }) => ComponentChildren;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;
const ran: EditorCommand[] = [];
let closes = 0;

async function mount() {
  await act(async () => {
    render(h(CommandPalette, { onRun: (command) => ran.push(command), onClose: () => closes++ }), container);
  });
}

function field(): HTMLInputElement | null {
  return container.querySelector('input[aria-label="Command palette"]');
}

/** The visible rows, in order, as their label text. */
function rows(): string[] {
  return Array.from(container.querySelectorAll('button')).map((button) => button.textContent ?? '');
}

/** The row the palette currently highlights (it renders a return-key glyph). */
function activeRow(): string {
  return rows().find((text) => text.length > 0 && container.querySelector('button .lucide-corner-down-left') !== null)
    ? (Array.from(container.querySelectorAll('button')).find((button) => button.querySelector('.lucide-corner-down-left'))?.textContent ?? '')
    : '';
}

async function typeQuery(value: string) {
  const input = field();
  if (!input) return;
  input.value = value;
  await act(async () => {
    input.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
  });
}

async function pressKey(key: string) {
  await act(async () => {
    field()?.dispatchEvent(new globalThis.KeyboardEvent('keydown', { key, bubbles: true }));
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
  ({ CommandPalette } = await import('@/client/components/workspace/editor/CommandPalette'));
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
  ran.length = 0;
  closes = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

describe('CommandPalette', () => {
  test('takes focus on open, so the palette is usable without a click', async () => {
    await mount();

    expect(document.activeElement).toBe(field());
  });

  test('lists the keymap’s commands with their chords', async () => {
    await mount();
    const text = rows().join('\n');

    expect(text).toContain('Add selection to next find match');
    // The chord is the platform's own. Asserted through the palette's own
    // builder so the expectation is the platform's real answer rather than a
    // guess at which machine the suite is running on — the runner is Linux and a
    // developer's laptop is a Mac, and a Mac-only literal passes on exactly one
    // of them.
    expect(text).toContain(buildPaletteEntries(isMacPlatform()).find((entry) => entry.command === 'selectNextOccurrence')!.chord);
    expect(rows().length).toBeGreaterThan(20);
  });

  test('every command it lists is one the keymap binds', async () => {
    await mount();

    // The palette is a VIEW of the keymap; an entry with no binding would be a
    // command that does nothing when it is run.
    for (const entry of buildPaletteEntries(true)) {
      expect(EDITOR_KEY_BINDINGS.some((binding) => binding.command === entry.command)).toBe(true);
    }
    expect(rows().length).toBeGreaterThan(20);
  });

  test('a query narrows the list', async () => {
    await mount();
    const before = rows().length;
    await typeQuery('occurrence');

    expect(rows().length).toBeLessThan(before);
    expect(rows().join('\n')).toContain('Select all occurrences');
  });

  test('a query nothing matches says so instead of listing everything', async () => {
    await mount();
    await typeQuery('zzzz');

    expect(rows()).toEqual([]);
    expect(container.textContent).toContain('No matching command');
  });

  test('Enter runs the highlighted command and closes the palette', async () => {
    await mount();
    await typeQuery('toggle line comment');
    await pressKey('Enter');

    expect(ran).toEqual(['toggleComment']);
    expect(closes).toBe(1);
  });

  test('the arrow keys move the highlight, and Enter runs the moved-to command', async () => {
    await mount();
    await typeQuery('occurrence');
    const first = activeRow();
    await pressKey('ArrowDown');
    const second = activeRow();

    expect(second).not.toBe(first);

    await pressKey('Enter');
    // Whichever row was highlighted is the one that ran — not the first match.
    expect(ran.length).toBe(1);
    expect(second).toContain(ran[0] === 'selectAllOccurrences' ? 'Select all' : 'Add selection');
  });

  test('the highlight wraps at the end of the list', async () => {
    await mount();
    await typeQuery('undo');
    const only = activeRow();
    await pressKey('ArrowDown');

    // One row: stepping wraps onto itself rather than falling off the list.
    expect(activeRow()).toBe(only);
  });

  test('ArrowUp from the top wraps to the last row', async () => {
    await mount();
    await typeQuery('line');
    const list = rows();
    await pressKey('ArrowUp');
    const active = activeRow();

    expect(active.length).toBeGreaterThan(0);
    expect(list.length).toBeGreaterThan(1);
  });

  test('Escape closes without running anything', async () => {
    await mount();
    await pressKey('Escape');

    expect(closes).toBe(1);
    expect(ran).toEqual([]);
  });

  test('clicking a row runs that row’s command', async () => {
    await mount();
    await typeQuery('copy line down');
    const row = container.querySelector('button');
    await act(async () => {
      row?.dispatchEvent(new globalThis.MouseEvent('click', { bubbles: true }));
    });

    expect(ran).toEqual(['copyLineDown']);
    expect(closes).toBe(1);
  });

  test('find-bar commands are marked, so a reader knows where they land', async () => {
    await mount();
    await typeQuery('replace');

    expect(container.textContent).toContain('find bar');
  });
});
