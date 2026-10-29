/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The hover card's contract: one row per fact the registry actually reports.
 *
 * The card is built from data rather than hand-written rows, and the rows that
 * used to drift (six copies, three separator treatments, `items-start` on one)
 * are now one shape. What a test can hold is the CONTENT rule: a fact with no
 * value is absent, not blank, and the cache line composes from whichever halves
 * exist.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelSpecsTooltip } from '@/client/components/workspace/model-dropdown/SpecsTooltip';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { AIModelOption } from '@/shared/types';

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

function mount(model: AIModelOption | null): void {
  act(() => {
    render(h(ModelSpecsTooltip, { model }), container);
  });
}

/** Label → value, in render order. */
function rows(): Array<[string, string]> {
  return Array.from(container.querySelectorAll('dl')).flatMap((list) => {
    const labels = Array.from(list.querySelectorAll('dt')).map((dt) => (dt.textContent ?? '').trim());
    const values = Array.from(list.querySelectorAll('dd')).map((dd) => (dd.textContent ?? '').trim());
    return labels.map((label, i) => [label, values[i] ?? ''] as [string, string]);
  });
}

describe('model specs card', () => {
  test('lists the facts the model reports, in reading order', () => {
    mount({
      id: 'v4',
      name: 'DeepSeek V4',
      provider: 'deepseek',
      capabilities: ['Tool calling', 'Vision'],
      contextWindow: 1_000_000,
      thinkingLevel: 'Default',
      input: 'text, image',
      output: 'text',
    });

    expect(rows().map(([label]) => label)).toEqual([
      'Capabilities',
      'Context',
      'Thinking',
      'Input',
      'Output',
    ]);
    expect(rows()[0][1]).toBe('Tool calling, Vision');
  });

  test('a fact with no value is absent rather than blank', () => {
    mount({ id: 'v4', name: 'DeepSeek V4', provider: 'deepseek', contextWindow: 128_000 });

    expect(rows()).toEqual([['Context', '128K']]);
  });

  test('the cache line composes from whichever halves exist', () => {
    mount({
      id: 'v4',
      name: 'DeepSeek V4',
      provider: 'deepseek',
      cost: { input: '$0.14', output: '$0.28', cacheRead: '$0.01' },
    });

    expect(rows()).toEqual([
      ['Cost', 'In $0.14 · Out $0.28'],
      ['Cache', 'Read $0.01'],
    ]);
  });

  test('a price is printed as the registry reported it', () => {
    // The registry carries the currency itself (`$0.14`), so a prefixed value
    // is passed through untouched — and a bare number is NOT given a `$` the
    // registry never claimed.
    mount({ id: 'v4', name: 'DeepSeek V4', provider: 'deepseek', cost: { input: 'free', output: 2 } });

    expect(rows()).toEqual([['Cost', 'In free · Out 2']]);
  });

  test('a cost row never prints a missing half', () => {
    mount({ id: 'v4', name: 'DeepSeek V4', provider: 'deepseek', cost: { input: '$1', output: '' } });

    expect(rows()).toEqual([['Cost', 'In $1']]);
  });

  test('the description is its own group, below a separator', () => {
    mount({ id: 'v4', name: 'DeepSeek V4', provider: 'deepseek', contextWindow: 128_000, description: 'Vision model.' });

    const description = container.querySelector('p') as HTMLElement;
    expect(description.textContent).toBe('Vision model.');
    expect(description.className).toContain('border-t');
  });

  test('a model with nothing to say draws no card', () => {
    mount({ id: 'v4', name: 'DeepSeek V4', provider: 'deepseek' });
    expect(container.textContent).toBe('');

    mount(null);
    expect(container.textContent).toBe('');
  });
});
