/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The searchable select, at the sizes it exists for.
 *
 * A native `<select>` was the control here, and the measured reason it could not
 * stay: `omp (ACP)` publishes 221 models, which the OS popup shows as one
 * unsearchable scroll box — and a stored value of `provider/model` is not what a
 * reader should have to read.
 *
 * The contract pinned here is the one a hand-rolled listbox usually breaks:
 *
 *  - **Escape and outside-click close** it, and focus returns to the trigger;
 *  - **arrow keys walk the FILTERED rows**, so Enter cannot commit a row the
 *    reader is no longer looking at;
 *  - **the empty value stays a row** — "the agent decides" is a real choice, not
 *    the absence of one;
 *  - **a stale value stays visible** as `(not listed)` instead of being silently
 *    replaced by the first option, which is how a saved default used to change
 *    without anyone touching the form.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SearchSelect, type SearchSelectOption } from '@/client/components/common/search-select';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

const OPTIONS: SearchSelectOption[] = [
  { value: 'command-code/claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'command-code/claude-sonnet-5', group: 'command-code' },
  { value: 'command-code/gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: 'command-code/gpt-5.6-sol', group: 'command-code' },
  { value: 'opencode/deepseek-v4-flash', label: 'DeepSeek V4 Flash', hint: 'opencode/deepseek-v4-flash', group: 'opencode' },
];

function mount(props: Partial<Parameters<typeof SearchSelect>[0]> = {}) {
  const changes: string[] = [];
  render(
    h(SearchSelect, {
      value: '',
      options: OPTIONS,
      placeholder: 'Agent default',
      ariaLabel: 'Default model',
      onChange: (next: string) => changes.push(next),
      ...props,
    }),
    container,
  );
  return changes;
}

function trigger(): HTMLButtonElement {
  const node = container.querySelector('button[role="combobox"]');
  if (!node) throw new Error('no combobox trigger');
  return node as HTMLButtonElement;
}

function search(): HTMLInputElement {
  const node = document.querySelector('input[aria-label^="Search"]');
  if (!node) throw new Error('no search field');
  return node as HTMLInputElement;
}

function visibleOptions(): HTMLButtonElement[] {
  return [...document.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
}

/** A click the window's own constructors make, so happy-dom's event reaches preact. */
function click(node: Element) {
  node.dispatchEvent(new (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent('click', { bubbles: true }));
}

async function open() {
  await act(async () => {
    click(trigger());
    await Promise.resolve();
  });
}

async function type(text: string) {
  await act(async () => {
    const field = search();
    field.value = text;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function key(name: string, target: EventTarget = search()) {
  await act(async () => {
    const Keyboard = (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
    target.dispatchEvent(new Keyboard( 'keydown', { key: name, bubbles: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

describe('the trigger', () => {
  test('an empty value reads as the placeholder, and is still a combobox', () => {
    mount();
    expect(trigger().textContent).toContain('Agent default');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  test('a chosen value reads as its LABEL, not its stored selector', () => {
    // Stored as `command-code/claude-sonnet-5`; read as "Claude Sonnet 5".
    mount({ value: 'command-code/claude-sonnet-5' });
    expect(trigger().textContent).toContain('Claude Sonnet 5');
    expect(trigger().textContent).not.toContain('command-code/claude-sonnet-5');
  });

  test('a value the list no longer holds stays visible and is not silently replaced', () => {
    mount({ value: 'retired/model' });
    expect(trigger().textContent).toContain('retired/model (not listed)');
  });
});

describe('the list', () => {
  test('opening shows every option plus the empty one, grouped', async () => {
    mount();
    await open();
    // One row for "the agent decides" + three models.
    expect(visibleOptions()).toHaveLength(4);
    expect(document.body.textContent).toContain('command-code');
    expect(document.body.textContent).toContain('opencode');
  });

  test('search narrows by the label, the value, and with separators folded', async () => {
    mount();
    await open();
    // The empty row is not a search RESULT — "the agent decides" stays available
    // whatever the filter says — so it is always the first row.
    await type('deepseek');
    expect(visibleOptions().map((node) => node.textContent)).toEqual([
      expect.stringContaining('Agent default'),
      expect.stringContaining('DeepSeek V4 Flash'),
    ]);
    // The stored selector is searchable too, with separators folded.
    await type('sonnet5');
    expect(visibleOptions().map((node) => node.textContent)).toEqual([
      expect.stringContaining('Agent default'),
      expect.stringContaining('Claude Sonnet 5'),
    ]);
    // No match says so, and offers no model row — only the empty choice.
    await type('zzzz');
    expect(visibleOptions()).toHaveLength(1);
    expect(document.body.textContent).toContain('No match');
  });

  test('arrow keys walk the FILTERED rows and Enter commits the highlighted one', async () => {
    const changes = mount();
    await open();
    await type('gpt');
    // Filtered to one model; ArrowDown then Enter must not reach a row that the
    // filter removed.
    await key('ArrowDown');
    await key('Enter');
    expect(changes).toEqual(['command-code/gpt-5.6-sol']);
  });

  test('choosing the empty row reports an empty string, which is a real choice', async () => {
    const changes = mount({ value: 'opencode/deepseek-v4-flash' });
    await open();
    const empty = visibleOptions()[0]!;
    await act(async () => {
      click(empty);
      await Promise.resolve();
    });
    expect(changes).toEqual(['']);
  });

  test('a stale value is offered as a row so it can be cleared', async () => {
    mount({ value: 'retired/model' });
    await open();
    // Directly under the empty row, marked as not listed but still selectable.
    expect(visibleOptions()[1]?.textContent).toContain('retired/model (not listed)');
  });

  test('Escape closes and returns focus to the trigger', async () => {
    mount();
    await open();
    await act(async () => {
      const Keyboard = (window as unknown as { KeyboardEvent: typeof KeyboardEvent }).KeyboardEvent;
      document.dispatchEvent(new Keyboard('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  test('a disabled control does not open', async () => {
    mount({ disabled: true });
    await act(async () => {
      click(trigger());
      await Promise.resolve();
    });
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });
});
