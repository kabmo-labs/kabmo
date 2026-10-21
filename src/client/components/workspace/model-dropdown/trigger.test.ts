/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer trigger's provider/model label.
 *
 * The trigger showed `kenari • Deepseek-V4-1-Flash` as `kena… • Deepse…` on a
 * 412px phone with 64px of unused room beside it. Two hardcoded caps were the
 * cause, and neither could see the space it was sitting in:
 *
 * - the WRAPPER carried `max-w-[58%]` on the phone, a share of the toolbar
 *   that ignores the four controls to its right;
 * - the LABEL carried `max-w-[280px]`, a fixed budget that has nothing to do
 *   with the panel width (the chat column is 320px wide on a 1440px screen).
 *
 * Measured before/after at a 412px viewport: the label went 117px → 210px
 * available and the model name 80px → 110px, with the toolbar reporting no
 * overflow and the action strip still ending 12px inside its own edge.
 *
 * The rule this file pins is the one that has to hold at EVERY width: the
 * model name is the only thing that gives up width. The provider is an
 * identity ("kenari" and "kenari-jatis" are different accounts), so shrinking
 * it first made two accounts render as the same `kena…`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelDropdown } from '@/client/components/workspace/model-dropdown/index';
import type { AIModelOption } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const MODEL: AIModelOption = {
  id: 'deepseek-v4-1-flash',
  name: 'Deepseek-V4-1-Flash',
  provider: 'kenari',
};

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

afterAll(() => restoreDomGlobals());

function mount(className: string, model: AIModelOption = MODEL): HTMLElement {
  act(() => {
    render(h(ModelDropdown, { selectedModel: model, className }), container);
  });
  return container;
}

/** The trigger button is the only one carrying the provider • model title. */
function trigger(el: HTMLElement): HTMLButtonElement {
  const button = el.querySelector('button[title]') as HTMLButtonElement | null;
  if (!button) throw new Error('model trigger button not found');
  return button;
}

function labelParts(el: HTMLElement): { provider: HTMLElement; separator: HTMLElement; model: HTMLElement } {
  const provider = el.querySelector('button[title] > span > span') as HTMLElement | null;
  const separator = provider?.nextElementSibling as HTMLElement | null;
  const model = separator?.nextElementSibling as HTMLElement | null;
  if (!provider || !separator || !model) throw new Error('label parts not found');
  return { provider, separator, model };
}

describe('composer model trigger label', () => {
  test('grows to its content instead of a fixed px budget', () => {
    // `max-w-[280px]` is what truncated a 216px model name inside a 968px
    // toolbar; the cap has to come from the flex parent, not from a constant.
    const { provider, model } = labelParts(mount('min-w-0'));
    const label = provider.parentElement!;

    expect(label.className).not.toContain('max-w-');
    expect(provider.className).not.toContain('truncate');
    expect(model.className).toContain('truncate');
  });

  test('keeps the provider at its natural width and lets the model shrink', () => {
    // Two accounts (`kenari` / `kenari-jatis`) render identically once the
    // provider truncates, which is why it must not be a shrink target.
    const { provider, separator, model } = labelParts(mount('min-w-0'));

    expect(provider.className).toContain('shrink-0');
    expect(separator.className).toContain('shrink-0');
    expect(model.className).toContain('flex-1');
    expect(model.className).toContain('min-w-0');
  });

  test('the trigger itself may shrink on every layout', () => {
    // The phone-only `max-w-[58%]` made the trigger a property of the layout
    // rather than of the room beside it: a 479px viewport left 64px unused.
    const button = trigger(mount('min-w-0'));
    expect(button.className).toContain('min-w-0');
    expect(button.className).not.toContain('max-w-[58%]');
  });

  test('names both halves in the title, so an ellipsis never hides the identity', () => {
    const button = trigger(mount('min-w-0'));
    expect(button.title).toBe('kenari • Deepseek-V4-1-Flash');
  });
});
