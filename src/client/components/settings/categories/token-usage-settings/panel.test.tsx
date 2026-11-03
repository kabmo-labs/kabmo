/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage panel's period control and its breakdown table.
 *
 * The panel has ONE period control, because Day / Week / Month / 90 days / All
 * time / Custom are all the same kind of choice: which trailing span to report.
 * Two things are pinned here, because both were reported as bugs:
 *
 *  - choosing a period must be a single click in one list (there is no second
 *    daily/weekly/monthly switch beside it);
 *  - no figure may be a per-day/per-week average — a period is one span, so
 *    every number is that span's total, and a derived "per day" number is what
 *    made the selector look like it only repainted the chart.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { TokenUsageControls } from '@/client/components/settings/categories/token-usage-settings/Controls';
import { TokenUsageBreakdown } from '@/client/components/settings/categories/token-usage-settings/Breakdown';
import { dayRows, providerModelRows } from '@/shared/lib/usage/breakdown';
import { timeRangeOptions } from '@/shared/lib/usage/range';
import type { UsageProviderRow, UsageTotals } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let picked: string[];
let from: string[];
let to: string[];

const NOW = new Date(2026, 10, 3, 12).getTime();

function controls(): void {
  render(
    h(TokenUsageControls, {
      range: '30d',
      onRange: (value: string) => picked.push(value),
      ranges: timeRangeOptions(NOW),
      customFrom: '2026-10-05',
      customTo: '2026-11-03',
      onCustomFrom: (value: string) => from.push(value),
      onCustomTo: (value: string) => to.push(value),
      periodLabel: 'Oct 5 – Nov 3, 2026',
      generatedAt: NOW,
      refreshing: false,
      onRefresh: () => {},
    }),
    container,
  );
}

const buttons = (): HTMLButtonElement[] => [...container.querySelectorAll('button')];

beforeEach(() => {
  installDomGlobals(new Window({ url: 'http://127.0.0.1/' }));
  container = document.createElement('div');
  document.body.append(container);
  picked = [];
  from = [];
  to = [];
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

describe('TokenUsageControls', () => {
  test('the trigger names the ACTIVE period, not a generic "Custom…"', () => {
    controls();
    const trigger = buttons()[0];
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Month');
  });

  test('one list holds every span, so there is no second cadence switch', () => {
    controls();
    act(() => buttons()[0].click());
    const labels = buttons().map((button) => button.textContent?.trim() ?? '');
    // Day/Week/Month ARE periods here; a "Daily / Weekly / Monthly" group would
    // be the duplicate control this replaced.
    expect(labels.some((label) => label.startsWith('Day'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Week'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Month'))).toBe(true);
    expect(labels.some((label) => label.startsWith('90 days'))).toBe(true);
    expect(labels.some((label) => label.startsWith('All time'))).toBe(true);
    expect(labels.some((label) => label.startsWith('Custom…'))).toBe(true);
    expect(container.textContent).not.toContain('Daily');
  });

  test('choosing a span reports that range and closes the list', () => {
    controls();
    act(() => buttons()[0].click());
    const week = buttons().find((button) => button.textContent?.trim().startsWith('Week'));
    act(() => week?.click());
    expect(picked).toEqual(['7d']);
    expect(container.textContent).not.toContain('Custom…');
  });

  test('the period menu is anchored to the left edge on phones', () => {
    controls();
    act(() => buttons()[0].click());
    const menu = [...container.querySelectorAll('div.absolute')].find((el) =>
      (el.textContent ?? '').includes('Custom…'),
    );
    // `right-0` on a full-width trigger hung the menu off the LEFT of the
    // viewport (measured at x=-157); it anchors left and only right-aligns from
    // `sm` up.
    expect(menu?.className).toContain('left-0');
    expect(menu?.className).toContain('sm:right-0');
    expect(menu?.className).toContain('max-w-[calc(100vw-2rem)]');
  });

  test('a custom span exposes both date inputs, capped at the payload day', () => {
    render(
      h(TokenUsageControls, {
        range: 'custom',
        onRange: (value: string) => picked.push(value),
        ranges: timeRangeOptions(NOW),
        customFrom: '2026-10-05',
        customTo: '2026-11-03',
        onCustomFrom: (value: string) => from.push(value),
        onCustomTo: (value: string) => to.push(value),
        periodLabel: 'Oct 5 – Nov 3, 2026',
        generatedAt: NOW,
        refreshing: false,
        onRefresh: () => {},
      }),
      container,
    );
    // The button itself names the window, so an equal-to-preset range is still
    // visibly a different state.
    expect(buttons()[0].textContent).toContain('2026-10-05 – 2026-11-03');
    act(() => buttons()[0].click());
    const inputs = [...container.querySelectorAll('input[type=date]')] as HTMLInputElement[];
    expect(inputs.map((input) => input.value)).toEqual(['2026-10-05', '2026-11-03']);
    expect(inputs[1].max).toBe('2026-11-03');
  });
});

describe('TokenUsageBreakdown', () => {
  const totals: UsageTotals = {
    cost: 20, tokens: 1_000_000, input: 50_000, output: 50_000, cacheRead: 900_000,
    cacheWrite: 0, reasoning: 0, cacheReadCost: 1, records: 40, unpriced: 0, activeDays: 6,
  };
  const providers: UsageProviderRow[] = [
    {
      id: 'kenari-jatis', name: 'Kenari Jatis', cost: 18, tokens: 900, input: 0, output: 0,
      cacheRead: 0, cacheWrite: 0, reasoning: 0, cacheReadCost: 0, records: 1, unpriced: 0,
      models: [{
        model: 'deepseek-v4-1-flash', cost: 18, tokens: 900, input: 0, output: 0,
        cacheRead: 0, cacheWrite: 0, reasoning: 0, cacheReadCost: 0, records: 1, unpriced: 0,
      }],
    },
  ];

  function table(granularity: 'day' | 'week' | 'month'): void {
    render(
      h(TokenUsageBreakdown, {
        tab: 'model',
        onTab: () => {},
        rows: providerModelRows(providers, totals.cost),
        totals,
        granularity,
        providerNames: { 'kenari-jatis': 'Kenari Jatis' },
      }),
      container,
    );
  }

  test('every cell is the period total — no per-day or per-week figure', () => {
    table('day');
    const text = container.textContent ?? '';
    expect(text).toContain('$18.00');
    expect(text).toContain('900');
    // The averages that made the selector look inert are gone.
    expect(text).not.toMatch(/\/day|\/wk|\/mo|per day|per week|per month/);
    expect(text).toContain('period total');
  });

  test('the time tab is named for the bucket width the period implies', () => {
    table('week');
    const labels = [...container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim());
    expect(labels).toContain('WEEK');
    expect(labels).not.toContain('DAY');
  });

  test('a time tab renders every row of the period, never a truncated eight', () => {
    // Eleven days of period, two of which saw usage: the table must list all
    // eleven, because it describes the PERIOD, not the days that had work.
    const days = Array.from({ length: 11 }, (_, index) => ({
      day: `2026-11-${String(index + 1).padStart(2, '0')}`,
      providers: {},
      cost: index === 3 ? 4 : 0,
      tokens: index === 3 ? 40 : 0,
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
      cacheReadCost: 0, records: index === 3 ? 2 : 0, unpriced: 0,
    }));
    render(
      h(TokenUsageBreakdown, {
        tab: 'day',
        onTab: () => {},
        rows: dayRows(days, 'day', 4, { from: '2026-11-01', to: '2026-11-11' }),
        totals,
        granularity: 'day',
        providerNames: {},
      }),
      container,
    );
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(11);
    // The period is fully listed, so there is no "show all" left to click.
    expect(container.textContent).not.toContain('Show all');
    expect(container.textContent).toContain('11 rows · day');
  });

  test('the tab row can wrap, so the last tab is never pushed out of the card', () => {
    table('month');
    const header = container.querySelector('[role="tablist"][aria-label="Breakdown"]')?.parentElement;
    expect(header?.className).toContain('flex-wrap');
    // The four tabs must stay inside the card at phone widths; measured in the
    // browser, a non-wrapping row put PROJECT 14–84 px outside it.
    const tabs = [...container.querySelectorAll('[aria-label="Breakdown"] [role="tab"]')];
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['PROVIDER', 'MODEL', 'MONTH', 'PROJECT']);
  });

  test('the provider tree keeps both providers of one model id separate', () => {
    table('day');
    const text = container.textContent ?? '';
    expect(text).toContain('Kenari Jatis');
    expect(text.match(/deepseek-v4-1-flash/g)).toHaveLength(1);
  });
});
