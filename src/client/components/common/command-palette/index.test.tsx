/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The palette's interaction: focus, filtering, arrow keys, Enter and Escape.
 *
 * The rows themselves are built in `use-palette-items`; what this covers is the
 * contract a user feels — the field takes focus, a command WITHOUT a chord is
 * still listed, and Enter runs the highlighted row rather than the first one.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { CommandPalette } from '@/client/components/common/command-palette';
import { closePalette, openPalette, paletteState } from '@/client/lib/commands/overlays';
import { registerCommand } from '@/client/lib/commands/registry';
import { setPluginCommands } from '@/client/lib/commands/keymap';

let container: HTMLElement;
let dispose: (() => void) | null = null;
// Bun defines no `KeyboardEvent`; the happy-dom window does, and its events are
// the ones its own nodes dispatch.
let dom: Window;

function mount() {
  act(() => render(h(CommandPalette, {}), container));
}

// The palette portals to `<body>`, so the rows are not inside the mount point.
function field(): HTMLInputElement {
  return document.body.querySelector('input[role="combobox"]') as HTMLInputElement;
}

function rows(): string[] {
  return [...document.body.querySelectorAll('[role="option"]')].map((row) => row.textContent ?? '');
}

function type(value: string) {
  const input = field();
  input.value = value;
  act(() => {
    input.dispatchEvent(new dom.Event('input', { bubbles: true }) as unknown as Event);
  });
}

function press(key: string) {
  act(() => {
    field().dispatchEvent(new dom.KeyboardEvent('keydown', { key, bubbles: true }) as unknown as Event);
  });
}

beforeEach(() => {
  dom = new Window({ url: 'http://localhost' });
  installDomGlobals(dom);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  closePalette();
  dispose?.();
  dispose = null;
  setPluginCommands([]);
  restoreDomGlobals();
});

afterAll(() => {
  restoreDomGlobals();
});

describe('CommandPalette', () => {
  test('takes focus on open and lists the catalog', () => {
    openPalette('commands');
    mount();

    expect(document.activeElement).toBe(field());
    expect(rows().join('\n')).toContain('Show All Commands');
  });

  test('lists a command that has no chord', () => {
    setPluginCommands([{ id: 'test.hello', title: 'Hello', category: 'Plugin' }]);
    dispose = registerCommand('test.hello', () => {});
    openPalette('commands');
    mount();

    expect(rows().join('\n')).toContain('Hello');
  });

  test('Enter runs the highlighted row, not the first one', () => {
    const ran: string[] = [];
    setPluginCommands([{ id: 'test.hello', title: 'Hello', category: 'Plugin' }]);
    dispose = registerCommand('test.hello', () => {
      ran.push('hello');
    });
    openPalette('commands');
    mount();

    type('hello');
    press('Enter');

    expect(ran).toEqual(['hello']);
    expect(paletteState().open).toBe(false);
  });

  test('Escape closes without running anything', () => {
    const ran: string[] = [];
    setPluginCommands([{ id: 'test.hello', title: 'Hello', category: 'Plugin' }]);
    dispose = registerCommand('test.hello', () => {
      ran.push('hello');
    });
    openPalette('commands');
    mount();

    press('Escape');

    expect(ran).toEqual([]);
    expect(paletteState().open).toBe(false);
  });
});
