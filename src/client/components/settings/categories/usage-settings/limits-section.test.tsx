/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The quota section's two new shapes are asserted on the DOM, not on the
 * grouping helper alone: a correct group list wired to the wrong prop renders
 * one flat "Quota windows" grid, which is exactly the regression this covers.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { LimitsSection } from '@/client/components/settings/categories/usage-settings/LimitsSection';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { UsageLimitWindow } from '@/shared/types';

let container: HTMLElement;

const limit = (id: string, overrides: Partial<UsageLimitWindow> = {}): UsageLimitWindow => ({
  id,
  label: id,
  unit: 'percent',
  status: 'ok',
  ...overrides,
});

function mount(node: preact.ComponentChild): HTMLElement {
  act(() => render(node, container));
  return container;
}

function headings(dom: HTMLElement): string[] {
  return [...dom.querySelectorAll('h4')].map((heading) => heading.textContent ?? '');
}

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  restoreDomGlobals();
});

describe('LimitsSection sections', () => {
  test('Claude draws plan windows and its spend balance as separate sections', () => {
    const dom = mount(
      <LimitsSection
        providerId="anthropic"
        tracked
        limits={[
          limit('anthropic:5h', { label: 'Claude 5 Hour', usedFraction: 0.42 }),
          limit('anthropic:extra', {
            label: 'Claude Extra Usage',
            unit: 'usd',
            used: 4.2,
            limit: 25,
            remaining: 20.8,
            usedFraction: 0.168,
          }),
        ]}
      />,
    );
    expect(headings(dom)).toEqual(['Quota windows', 'Balance']);
    expect(dom.textContent).toContain('Claude Extra Usage');
    expect(dom.textContent).toContain('$4,20');
    expect(dom.textContent).toContain('$20,80');
  });

  test('Antigravity draws one heading per model family and merges the shared bucket', () => {
    const dom = mount(
      <LimitsSection
        providerId="google-antigravity"
        tracked
        limits={[
          limit('google-antigravity:google:default:weekly', {
            label: 'Gemini',
            windowLabel: 'weekly',
            usedFraction: 0.42,
          }),
          limit('google-antigravity:anthropic:default:5h', {
            label: 'Claude & GPT (shared)',
            usedFraction: 0.71,
          }),
          limit('google-antigravity:openai:default:5h', {
            label: 'Claude & GPT (shared)',
            usedFraction: 0.13,
          }),
        ]}
      />,
    );
    expect(headings(dom)).toEqual(['Google', 'Claude & GPT (shared)']);
    expect(dom.textContent).toContain('Gemini');
    expect(dom.textContent).toContain('weekly');
    // Two rows, one 5h row per third-party family, under ONE heading.
    expect(dom.querySelectorAll('h4')).toHaveLength(2);
    expect(dom.textContent?.match(/Claude & GPT \(shared\)/g)).toHaveLength(3);
  });

  test('an ordinary provider keeps the single Quota windows section', () => {
    const dom = mount(
      <LimitsSection providerId="openrouter" tracked limits={[limit('openrouter:credits', { unit: 'usd' })]} />,
    );
    expect(headings(dom)).toEqual(['Quota windows']);
  });

  test('an untracked provider with no rows keeps its explanation', () => {
    const dom = mount(<LimitsSection providerId="kenari" tracked={false} limits={[]} />);
    expect(headings(dom)).toEqual(['Quota windows']);
    expect(dom.textContent).toContain('No quota source for this provider');
  });
});
