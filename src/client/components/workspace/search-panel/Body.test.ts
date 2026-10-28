/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The search panel's clear (×) controls.
 *
 * Two properties matter and neither is visible from the state alone:
 *
 * - **The button lives INSIDE its field's box.** A control that empties an
 *   input belongs to that input; parked beside it, the panel reads as two
 *   unrelated controls and the × looks like it clears the panel.
 * - **A cleared field keeps focus.** The reason to clear a query is to type a
 *   different one, so handing focus back to the browser is half the job.
 *
 * The button also only exists while the field holds text — an always-present ×
 * is a control that can do nothing, and `aria-label` is what a screen reader
 * announces, so both are asserted.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { h as PreactH, render as PreactRender } from 'preact';
import type { act as PreactAct } from 'preact/test-utils';
import type { SearchPanelBody as SearchPanelBodyComponent } from '@/client/components/workspace/search-panel/Body';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let SearchPanelBody: typeof SearchPanelBodyComponent;
let h: typeof PreactH;
let render: typeof PreactRender;
let act: typeof PreactAct;

let container: HTMLElement;
let query = '';
let replaceQuery = '';

function mount() {
  const noop = () => {};
  act(() => {
    render(
      h(SearchPanelBody, {
        className: '',
        query,
        setQuery: (value: string) => { query = value; rerender(); },
        replaceQuery,
        setReplaceQuery: (value: string) => { replaceQuery = value; rerender(); },
        matchCase: false,
        setMatchCase: noop,
        wholeWord: false,
        setWholeWord: noop,
        useRegex: false,
        setUseRegex: noop,
        includeFiles: '',
        setIncludeFiles: noop,
        showIncludeField: false,
        setShowIncludeField: noop,
        showMenu: false,
        setShowMenu: noop,
        menuRef: { current: null },
        activeRepo: '.',
        setActiveRepo: noop,
        repos: ['.'],
        reposScanning: false,
        rescanRepos: noop,
        results: [],
        isSearching: false,
        truncated: false,
        error: null,
        handleReplace: noop,
        replaceBusy: false,
      }),
      container,
    );
  });
}

function rerender() {
  mount();
}

function button(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

beforeAll(async () => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  ({ SearchPanelBody } = await import('@/client/components/workspace/search-panel/Body'));
  ({ h, render } = await import('preact'));
  ({ act } = await import('preact/test-utils'));
});

afterAll(() => restoreDomGlobals());

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  query = '';
  replaceQuery = '';
});

describe('search panel clear controls', () => {
  test('no clear button while a field is empty', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    mount();

    expect(button('Clear search')).toBeNull();
    expect(button('Clear replace')).toBeNull();
  });

  test('the search clear button sits inside the search field and empties it', () => {
    query = 'kabmo';
    container = document.createElement('div');
    document.body.appendChild(container);
    mount();

    const clear = button('Clear search');
    expect(clear).not.toBeNull();
    // Inside the field: the input and the button share a parent box.
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search"]');
    expect(input).not.toBeNull();
    expect(clear!.parentElement).toBe(input!.parentElement);

    act(() => clear!.click());
    expect(query).toBe('');
    expect(button('Clear search')).toBeNull();
    expect(document.activeElement).toBe(input!);
  });

  test('the replace clear button sits inside the replace field and empties it', () => {
    query = 'kabmo';
    replaceQuery = 'KABMO';
    container = document.createElement('div');
    document.body.appendChild(container);
    mount();

    const clear = button('Clear replace');
    expect(clear).not.toBeNull();
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Replace"]');
    expect(input).not.toBeNull();
    expect(clear!.parentElement).toBe(input!.parentElement);

    act(() => clear!.click());
    expect(replaceQuery).toBe('');
    expect(button('Clear replace')).toBeNull();
    expect(document.activeElement).toBe(input!);
  });
});
