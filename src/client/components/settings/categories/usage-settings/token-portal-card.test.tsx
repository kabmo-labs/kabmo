/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The TokenPortal card's arithmetic is the regression surface: the endpoint's
 * numbers are whole Rupiah, an uncapped key has no quota window (so drawing a
 * 0%-used bar would claim a limit nobody set), and spend is derived from
 * `limit − limit_remaining`, not from `balance`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { TokenPortalCard } from '@/client/components/settings/categories/usage-settings/TokenPortalCard';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TokenPortalBalance } from '@/shared/types';

let container: HTMLElement;

const wallet = (overrides: Partial<TokenPortalBalance> = {}): TokenPortalBalance => ({
  label: 'Kabmo',
  currency: 'IDR',
  balance: 8827,
  limit: null,
  limitRemaining: 8827,
  isFreeTier: false,
  sessionBudget: null,
  ...overrides,
});

function mount(balance: TokenPortalBalance | null): HTMLElement {
  act(() => render(<TokenPortalCard report={balance ? { balance } : { error: 'TokenPortal rejected the API key (HTTP 401).' }} />, container));
  return container;
}

function text(dom: HTMLElement): string {
  return (dom.textContent ?? '').replace(/\s/g, '');
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

describe('TokenPortalCard wallet', () => {
  test('an uncapped key shows its Rupiah balance and no progress bar', () => {
    const dom = mount(wallet());
    expect(text(dom)).toContain('Rp8.827');
    expect(text(dom)).toContain('Nocap');
    expect(text(dom)).toContain('Notset');
    // A cap nobody set must not become a 0%-used bar.
    expect(dom.querySelectorAll('[role="progressbar"]')).toHaveLength(0);
  });

  test('a capped key derives spend from limit_remaining and draws the bar', () => {
    const dom = mount(wallet({ balance: 15000, limit: 20000, limitRemaining: 12000 }));
    const bars = [...dom.querySelectorAll<HTMLElement>('[role="progressbar"]')];
    expect(bars).toHaveLength(1);
    expect(bars[0]?.getAttribute('aria-valuenow')).toBe('40');
    expect(text(dom)).toContain('Rp8.000');
    expect(text(dom)).toContain('Rp12.000');
  });

  test('a free-tier key states the tier in words', () => {
    expect(text(mount(wallet({ isFreeTier: true })))).toContain('Free');
  });

  test('a missing balance says so instead of rendering an empty wallet', () => {
    expect(text(mount(null))).toContain('returnednobalance');
  });
});
