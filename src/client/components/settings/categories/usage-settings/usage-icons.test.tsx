/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Both Usage surfaces draw the provider's own mark.
 *
 * There are two of them — Settings → Usage (a sidebar list plus a card header)
 * and the right-panel Usage view (a dropdown) — and both drew
 * `ProviderIcon` alone, which resolves against the built-in glyph table. That
 * table cannot know a `models.yml` gateway, so a provider whose site favicon
 * had already been fetched and stored showed its logo in Settings → Providers
 * and bare initials in both Usage surfaces. The plate is what closes that gap,
 * and `iconUrl` is the field it needs on the summary.
 *
 * Pinned here rather than left to a screenshot: an `<img>` whose `src` is the
 * stored icon URL, on a plate of the surface's own size, and a provider WITHOUT
 * one still drawing the built-in mark (so a missing favicon cannot leave an
 * empty box).
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { UsageSidebarList } from '@/client/components/settings/categories/usage-settings/SidebarList';
import { ProviderSelect } from '@/client/components/workspace/usage-panel/ProviderSelect';
import { ProviderCard } from '@/client/components/settings/categories/usage-settings/ProviderCard';
import type { UsageReport } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const ICON = '/api/provider-icon?slug=localtest&v=7';

let container: HTMLElement;

const report: UsageReport = {
  isMock: false,
  generatedAt: '2026-01-01T00:00:00.000Z',
  providers: [
    {
      id: 'localtest',
      name: 'Local Test',
      iconUrl: ICON,
      credentialSources: ['models.yml'],
      tracked: true,
      limits: [],
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      credentialSources: ['environment'],
      tracked: false,
      limits: [],
    },
    {
      id: 'plain',
      name: 'Plain',
      credentialSources: ['environment'],
      tracked: false,
      limits: [],
    },
  ],
};

function mount(node: preact.ComponentChild): HTMLElement {
  act(() => render(node, container));
  return container;
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

describe('Settings → Usage sidebar', () => {
  test('a stored web icon is drawn in colour, on a plate', () => {
    const dom = mount(<UsageSidebarList report={report} selectedProviderId="localtest" onSelectProvider={() => {}} />);
    const image = dom.querySelector('img');
    expect(image?.getAttribute('src')).toBe(ICON);
    // The plate is the fixed box; the image is inset inside it (12% per side).
    const plate = image?.parentElement;
    expect(plate?.style.width).toBe('20px');
    expect(plate?.style.height).toBe('20px');
    expect(plate?.getAttribute('aria-hidden')).toBe('true');
  });

  test('a provider with no icon still draws the built-in mark', () => {
    const dom = mount(<UsageSidebarList report={report} selectedProviderId="deepseek" onSelectProvider={() => {}} />);
    // Three rows, one image: a provider without a stored favicon falls back to
    // the glyph table (deepseek) or to its initials (plain), never to an empty
    // plate.
    expect(dom.querySelectorAll('img')).toHaveLength(1);
    expect(dom.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(dom.textContent).toContain('p.');
  });
});

describe('right-panel Usage dropdown', () => {
  const providers = [
    { id: 'localtest', name: 'Local Test', iconUrl: ICON, hint: 'Connected', limits: [], tracked: true, summary: report.providers[0]! },
    { id: 'plain', name: 'Plain', hint: 'Connected', limits: [], tracked: false, summary: report.providers[2]! },
  ];

  test('the trigger and its option rows both carry the web icon', () => {
    const dom = mount(<ProviderSelect providers={providers} value="localtest" onChange={() => {}} />);
    const trigger = dom.querySelector('button[aria-haspopup="listbox"]');
    const triggerImage = trigger?.querySelector('img');
    expect(triggerImage?.getAttribute('src')).toBe(ICON);
    expect(triggerImage?.parentElement?.style.width).toBe('16px');

    act(() => (trigger as HTMLButtonElement).click());
    const option = dom.querySelector('[role="option"]');
    const optionImage = option?.querySelector('img');
    expect(optionImage?.getAttribute('src')).toBe(ICON);
    expect(optionImage?.parentElement?.style.width).toBe('18px');
    // The second option has no icon URL, so only one row draws an image.
    expect(dom.querySelectorAll('[role="option"] img')).toHaveLength(1);
  });
});

describe('Usage provider card header', () => {
  test('the card names the provider and carries its mark', () => {
    const dom = mount(<ProviderCard providerName="Local Test" providerSlug="localtest" iconUrl={ICON} credentialSources={['models.yml']}>body</ProviderCard>);
    const header = dom.querySelector('header');
    expect(header?.textContent).toContain('Local Test');
    expect(header?.querySelector('img')?.getAttribute('src')).toBe(ICON);
    expect(header?.querySelector('img')?.parentElement?.style.width).toBe('20px');
  });

  test('without a slug the header is the name alone', () => {
    const dom = mount(<ProviderCard providerName="Bare" credentialSources={[]}>body</ProviderCard>);
    expect(dom.querySelector('header img')).toBeNull();
    expect(dom.querySelector('header')?.textContent).toContain('Bare');
  });
});
