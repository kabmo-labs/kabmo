/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Accent colour" — the presets, and the custom colour beside them.
 *
 * What is pinned here is the WRITE GRANULARITY as much as the value: the custom
 * control commits on the colour input's `change` and on the text field's
 * blur/Enter, never on `input`. Dragging inside the system colour panel fires
 * hundreds of `input`s, and each commit is a PATCH carrying the whole project —
 * so committing per keystroke would flood the store and let the last one win.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { ProjectAccentPalette } from '@/client/components/settings/categories/project-settings/AccentPalette';
import { DEFAULT_CUSTOM_ACCENT } from '@/shared/lib/workspace/project-accent';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
const picks: string[] = [];

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  picks.length = 0;
});

afterAll(() => {
  restoreDomGlobals();
});

function mount(accentColor: string): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  act(() =>
    render(
      h(ProjectAccentPalette, {
        accentColor,
        onSelectColor: (color: string) => picks.push(color),
      }),
      container,
    ),
  );
  return container;
}

function swatch(root: HTMLElement, label: string): HTMLElement {
  const target = root.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
  if (!target) throw new Error(`no swatch labelled ${label}`);
  return target;
}

function hexField(root: HTMLElement): HTMLInputElement {
  const field = root.querySelector<HTMLInputElement>('input[type="text"]');
  if (!field) throw new Error('no hex field');
  return field;
}

function colorInput(root: HTMLElement): HTMLInputElement {
  const field = root.querySelector<HTMLInputElement>('input[type="color"]');
  if (!field) throw new Error('no colour input');
  return field;
}

function type(field: HTMLInputElement, value: string): void {
  act(() => {
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** `KeyboardEvent`/`FocusEvent` are not among the installed DOM globals, and the
 *  happy-dom ones are what the field's own document dispatches. */
function eventField(field: HTMLInputElement, type: string, init: Record<string, unknown>): void {
  const view = field.ownerDocument.defaultView as unknown as Record<string, new (name: string, init?: unknown) => Event>;
  const Ctor = type === 'keydown' ? view.KeyboardEvent : view.FocusEvent;
  if (!Ctor) throw new Error(`no ${type} constructor`);
  act(() => {
    field.dispatchEvent(new Ctor(type, init));
  });
}

function press(field: HTMLInputElement, key: string): void {
  eventField(field, 'keydown', { key, bubbles: true });
}

function leave(field: HTMLInputElement): void {
  eventField(field, 'blur', {});
}

describe('ProjectAccentPalette', () => {
  test('the stored preset is the selected swatch', () => {
    const root = mount('#f43f5e');
    expect(swatch(root, 'Rose').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(root, 'Teal').getAttribute('aria-pressed')).toBe('false');
  });

  test('clicking a preset writes its value', () => {
    const root = mount('#f43f5e');
    act(() => swatch(root, 'Teal').click());
    expect(picks).toEqual(['#2dd4bf']);
  });

  test('no accent selects the None swatch and is NOT a custom colour', () => {
    const root = mount('');
    expect(swatch(root, 'No accent colour').getAttribute('aria-pressed')).toBe('true');
    expect(root.textContent).not.toContain('Custom accent');
    expect(hexField(root).value).toBe(DEFAULT_CUSTOM_ACCENT);
  });

  test('a stored colour outside the palette reads as custom, and the field shows it', () => {
    const root = mount('#7c3aed');
    expect(root.textContent).toContain('Custom accent');
    expect(hexField(root).value).toBe('#7c3aed');
    // ...and no preset is highlighted, because none of them is that colour.
    expect([...root.querySelectorAll('button[aria-label]')].some(
      (button) => button.getAttribute('aria-pressed') === 'true',
    )).toBe(false);
  });

  test('a typed hex is committed on Enter, normalised', () => {
    const root = mount('#38bdf8');
    const field = hexField(root);
    type(field, '#ABC');
    expect(picks).toEqual([]);
    press(field, 'Enter');
    expect(picks).toEqual(['#aabbcc']);
  });

  test('a typed hex is committed on blur', () => {
    const root = mount('#38bdf8');
    const field = hexField(root);
    type(field, '#010203');
    leave(field);
    expect(picks).toEqual(['#010203']);
  });

  test('an unparseable draft writes nothing and the field returns to the stored colour', () => {
    const root = mount('#38bdf8');
    const field = hexField(root);
    type(field, 'red;background:url(//evil)');
    press(field, 'Enter');
    expect(picks).toEqual([]);
    expect(field.value).toBe('#38bdf8');
  });

  test('Escape abandons the draft', () => {
    const root = mount('#38bdf8');
    const field = hexField(root);
    type(field, '#abcdef');
    press(field, 'Escape');
    expect(field.value).toBe('#38bdf8');
    leave(field);
    expect(picks).toEqual([]);
  });

  test('emptying the field clears the accent rather than writing nothing', () => {
    const root = mount('#38bdf8');
    const field = hexField(root);
    type(field, '');
    leave(field);
    expect(picks).toEqual(['']);
  });

  test('the colour input writes on change, not on every input', () => {
    const root = mount('#38bdf8');
    const input = colorInput(root);
    act(() => {
      input.value = '#123456';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    // Still dragging: the swatch previews it, the store hears nothing.
    expect(picks).toEqual([]);
    act(() => {
      input.value = '#123456';
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(picks).toEqual(['#123456']);
  });
});