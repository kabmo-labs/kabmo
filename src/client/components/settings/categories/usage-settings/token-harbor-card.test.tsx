/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Harbor card's states are asserted on the DOM, not on the parser:
 * a correct allowance wired to the wrong branch renders a reassuring 0% on a
 * window that has not started, or hides the fact that free models are switched
 * off. Both are the regressions this covers.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { TokenHarborCard } from '@/client/components/settings/categories/usage-settings/TokenHarborCard';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TokenHarborAllowance } from '@/shared/types';

let container: HTMLElement;

const allowance = (overrides: Partial<TokenHarborAllowance> = {}): TokenHarborAllowance => ({
  planName: 'Agent Pass',
  onPlan: true,
  planUsedPct: 37,
  planExhausted: false,
  usedPct: 12,
  exhausted: false,
  activated: true,
  resetAt: '2026-11-30T07:45:14.048+00:00',
  periodStartedAt: '2026-11-23T07:45:14.048+00:00',
  periodEndsAt: '2026-11-30T07:45:14.048+00:00',
  freeModels: ['deepseek-v4-flash', 'mimo-v2.6-flash'],
  modelsEnabled: true,
  ...overrides,
});

function mount(report: TokenHarborAllowance): HTMLElement {
  act(() => render(<TokenHarborCard report={{ allowance: report }} />, container));
  return container;
}

function bars(dom: HTMLElement): HTMLElement[] {
  return [...dom.querySelectorAll<HTMLElement>('[role="progressbar"]')];
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

describe('TokenHarborCard allowance bars', () => {
  test('a Pass and the free allowance draw two labelled bars with their percentages', () => {
    const dom = mount(allowance());
    expect(bars(dom).map((bar) => bar.getAttribute('aria-label'))).toEqual(['Agent Pass', 'Free allowance']);
    expect(bars(dom).map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['37', '12']);
    expect(dom.textContent).toContain('Free models now: deepseek-v4-flash, mimo-v2.6-flash');
    expect(dom.textContent).not.toContain('Spent');
  });

  test('a spent Pass is stated as text and painted with the error tint', () => {
    const dom = mount(allowance({ planUsedPct: 100, planExhausted: true }));
    expect(dom.textContent).toContain('Spent');
    expect(dom.textContent).toContain('Covered calls resume when the window resets');
    // The panel cannot read the wallet-continuation toggle, so it must name the
    // setting rather than claim calls simply stop.
    expect(dom.textContent).toContain('Keep working after my Pass allowance runs out');
    expect(bars(dom)[0]?.firstElementChild?.className).toContain('bg-error/70');
  });

  test('an account without a Pass draws no Pass bar and says why', () => {
    const dom = mount(allowance({ onPlan: false, planName: null, planUsedPct: 0 }));
    expect(bars(dom).map((bar) => bar.getAttribute('aria-label'))).toEqual(['Free allowance']);
    expect(dom.textContent).toContain('no Pass allowance to draw');
  });

  test('a window that never started does not read as a reassuring 0%', () => {
    const dom = mount(allowance({
      activated: false,
      planUsedPct: 0,
      usedPct: 0,
      resetAt: null,
      periodStartedAt: null,
      periodEndsAt: null,
    }));
    expect(dom.textContent).toContain('Not started');
    expect(dom.textContent).toContain('starts with this account');
    expect(dom.textContent).not.toContain('30 Nov');
  });

  test('free models that are switched off drop the bar value and name the action', () => {
    const dom = mount(allowance({ modelsEnabled: false, usedPct: 4 }));
    // A switched-off allowance is not a progress reading: it carries no
    // progressbar role at all, so a screen reader cannot announce "4%".
    expect(bars(dom).map((bar) => bar.getAttribute('aria-label'))).toEqual(['Agent Pass']);
    expect(dom.textContent).toContain('Off');
    expect(dom.textContent).toContain('switched off');
    expect(dom.textContent).toContain('Data and privacy');
  });

  test('a report with no allowance says so instead of drawing empty bars', () => {
    act(() => render(<TokenHarborCard report={{ error: 'Token Harbor rejected the API key' }} />, container));
    expect(bars(container)).toHaveLength(0);
    expect(container.textContent).toContain('returned no allowance');
  });
});