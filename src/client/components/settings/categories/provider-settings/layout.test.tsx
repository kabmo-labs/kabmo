/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider list's column grid.
 *
 * Three things in this list read as one table and were not one: the mark, the
 * status dot and the model count. The mark is an `<svg>` for a brand but a
 * text-width PILL for the initials fallback, so every row's name began at a
 * different x; the dot carried `ml-auto` and so followed the name's width; and
 * the delete button existed only on some rows, shifting those rows' count
 * column by its own width. Measured in a browser before the fix: 97 rows, three
 * different dot positions.
 *
 * The layout is therefore: a fixed-size PLATE, a name that takes the slack
 * (`flex-1`), a fixed dot slot, a fixed right-aligned count, and a delete slot
 * reserved on every row. Those are geometry facts, so they are pinned here
 * rather than left to a screenshot.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ProviderSidebarList } from '@/client/components/settings/categories/provider-settings/SidebarList';
import { ProviderHeader } from '@/client/components/settings/categories/provider-settings/Header';
import type { ProviderItem } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function provider(overrides: Partial<ProviderItem> & { slug: string }): ProviderItem {
  return {
    id: `id-${overrides.slug}`,
    name: overrides.slug,
    icon: overrides.slug,
    status: 'connected',
    configuredIn: 'models.yml',
    models: [],
    ...overrides,
  };
}

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

interface MountOptions {
  isRefreshing?: boolean;
  isLoading?: boolean;
  onRefresh?: () => void;
}

function mountList(providers: ProviderItem[], options: MountOptions = {}): void {
  act(() => {
    render(
      h(ProviderSidebarList, {
        providers,
        selectedProviderId: providers[0]?.id ?? '',
        onSelectProvider: () => {},
        onOpenAddModal: () => {},
        onRefresh: options.onRefresh ?? (() => {}),
        isRefreshing: options.isRefreshing ?? false,
        isLoading: options.isLoading ?? false,
      }),
      container,
    );
  });
}

/** Every provider row's select button, in list order. */
function rows(): HTMLElement[] {
  return [...container.querySelectorAll('button[title]')].filter(
    (button) => button.querySelector('span[aria-hidden]') !== null,
  ) as HTMLElement[];
}

describe('provider list columns', () => {
  test('a row is a plate, a name and a count — and nothing else', () => {
    mountList([
      provider({ slug: 'a', name: 'A' }),
      provider({ slug: 'b', name: 'A much longer provider name than the first' }),
    ]);

    for (const row of rows()) {
      const children = [...row.children] as HTMLElement[];
      // Exactly three: the plate, the name, the count. The status dot and the
      // per-row delete button were removed — the section already states the
      // provider's state, and deleting belongs to the detail pane.
      expect(children).toHaveLength(3);
      const [plate, name, count] = children;
      expect(plate.style.width).toBe('22px');
      expect(plate.style.height).toBe('22px');
      // The name absorbs the difference between short and long names.
      expect(name.className).toContain('flex-1');
      expect(name.className).toContain('truncate');
      expect(count.className).toContain('w-8');
      expect(count.className).toContain('text-right');
      expect(count.className).toContain('tabular-nums');
    }
  });

  test('no row carries a status dot or a delete control', () => {
    mountList([
      provider({ slug: 'native', inModelsYml: true }),
      provider({ slug: 'discovered' }),
      provider({ slug: 'off', disabled: true }),
    ]);

    // A coloured circle repeated a state the section header already names, and a
    // trash icon on every row made a dense list a field of mostly-hidden icons.
    expect(container.querySelectorAll('span.rounded-full')).toHaveLength(0);
    expect(container.querySelectorAll('button[aria-label^="Delete "]')).toHaveLength(0);
  });

  test('the mark sits on a rounded plate', () => {
    mountList([provider({ slug: 'branded' })]);

    const plate = rows()[0].children[0] as HTMLElement;
    expect(plate.className).toContain('border');
    expect(plate.className).toContain('bg-ink/5');
    expect(plate.style.borderRadius).not.toBe('');
    expect(plate.style.width).toBe(plate.style.height);
  });

  test('the count is a plain number, so the digits can be compared down the column', () => {
    mountList([
      provider({ slug: 'a', models: Array.from({ length: 109 }, (_, index) => ({
        id: `m${index}`, name: `M${index}`, contextWindow: '', hasTools: true, hasVision: false, isVisible: true,
      })) }),
      provider({ slug: 'b', models: [] }),
    ]);

    const counts = rows().map((row) => row.children[2].textContent);
    expect(counts).toEqual(['109', '0']);
  });

  test('the row still names its state in the title, now that the dot is gone', () => {
    mountList([provider({ slug: 'a', status: 'disconnected', oauth: true })]);

    expect(rows()[0].getAttribute('title')).toContain('sign in with OAuth');
  });
});

describe('provider header', () => {
  test('the name and the slug share one left edge', () => {
    // They used to be two stacked blocks with the slug indented by a hard-coded
    // `pl-8`, which only matched while the mark happened to be 32px wide.
    act(() => {
      render(h(ProviderHeader, { provider: provider({ slug: 'gateway', name: 'Gateway' }) }), container);
    });

    const plate = container.querySelector('span[aria-hidden]') as HTMLElement;
    const column = plate.nextElementSibling as HTMLElement;
    const [name, slug] = [...column.children] as HTMLElement[];
    expect(plate).not.toBeNull();
    // One column holds both lines: their left edges are the same element's.
    expect(name.tagName).toBe('H2');
    expect(slug.tagName).toBe('P');
    expect(slug.className).not.toContain('pl-');
    expect(column.className).toContain('min-w-0');
  });
});

describe('icon containment', () => {
  test('the mark is bounded: a fixed box, never the pill’s text width', () => {
    // The initials fallback is a PILL by design (width follows the text) — right
    // beside a name, wrong inside a plate: `ab.` at the unbounded 1.2x font came
    // out ~25px wide in a 20px content box and spilled past the rounded edge.
    mountList([provider({ slug: 'no-brand-mark-anywhere' })]);

    const plate = rows()[0].children[0] as HTMLElement;
    const mark = plate.firstElementChild as HTMLElement;
    expect(mark.tagName).toBe('SPAN');
    expect(mark.style.width).toBe('16px');
    expect(mark.style.height).toBe('16px');
    expect(mark.className).toContain('overflow-hidden');
    // The plate reserves a hairline plus a gap on each side of that box.
    expect(plate.style.width).toBe('22px');
  });

  test('a three-character badge gets a smaller font than a two-character one', () => {
    mountList([provider({ slug: 'toktok-id', name: 'Toktok ID' }), provider({ slug: 'tooker', name: 'Tooker' })]);

    const fonts = rows().map((row) => (row.children[0].firstElementChild as HTMLElement).style.fontSize);
    expect(fonts[0]).toBe('10px'); // `ti.`
    expect(fonts[1]).toBe('13px'); // `t.`
  });

  test('a brand mark is a block svg at the same box size', () => {
    // `display: block` is the containment contract for the SVG half: an inline
    // svg sits on the text baseline and adds descender space, so it can "fit"
    // its attributes and still push the plate's edge.
    mountList([provider({ slug: 'deepseek', name: 'DeepSeek' })]);

    const mark = rows()[0].children[0].firstElementChild as HTMLElement;
    expect(mark.tagName.toLowerCase()).toBe('svg');
    expect(mark.getAttribute('width')).toBe('16');
    expect(mark.getAttribute('height')).toBe('16');
    expect(mark.style.display).toBe('block');
  });

  test('the header plate bounds its mark too', () => {
    act(() => {
      render(h(ProviderHeader, { provider: provider({ slug: 'gateway', name: 'Gateway' }) }), container);
    });

    const plate = container.querySelector('span[aria-hidden]') as HTMLElement;
    const mark = plate.firstElementChild as HTMLElement;
    expect(plate.style.width).toBe('30px');
    expect(mark.style.width === '22px' || mark.getAttribute('width') === '22').toBe(true);
  });
});

describe('provider icon plate with a fetched web icon', () => {
  const withIcon = provider({
    slug: 'localtest',
    iconUrl: '/api/provider-icon?slug=localtest&v=1700000000000',
  });

  test('an iconUrl is drawn as the site’s own picture, not a recoloured mark', () => {
    // The whole point of fetching it: a brand logo in `currentColor` is a
    // silhouette. The img is the one thing in this list allowed chroma.
    mountList([withIcon]);

    const plate = rows()[0].children[0] as HTMLElement;
    const image = plate.querySelector('img') as HTMLImageElement;
    expect(image).not.toBeNull();
    expect(image.getAttribute('src')).toBe('/api/provider-icon?slug=localtest&v=1700000000000');
    expect(image.className).toContain('object-contain');
    // No filter/blend that would tint the logo.
    expect(image.className).not.toContain('grayscale');
    // The mark is not drawn beside it.
    expect(plate.querySelector('svg[fill="currentColor"]')).toBeNull();
  });

  test('a provider without one keeps the bounded mark', () => {
    mountList([provider({ slug: 'plain' })]);
    const plate = rows()[0].children[0] as HTMLElement;
    expect(plate.querySelector('img')).toBeNull();
    expect(plate.firstElementChild?.tagName).toBe('SPAN');
  });

  test('the header shows the web icon and offers a refetch control', () => {
    let pressed = 0;
    act(() => {
      render(
        h(ProviderHeader, { provider: withIcon, onRefreshIcon: () => { pressed += 1; } }),
        container,
      );
    });

    const plate = container.querySelector('span[aria-hidden]') as HTMLElement;
    expect(plate.querySelector('img')?.getAttribute('src')).toContain('/api/provider-icon');
    const refresh = container.querySelector('button[aria-label="Refresh provider icon"]') as HTMLButtonElement;
    expect(refresh).not.toBeNull();
    act(() => refresh.click());
    expect(pressed).toBe(1);
  });
});

describe('provider list refresh and loading', () => {
  test('the refresh control sits beside add, and pressing it re-reads the list', () => {
    let pressed = 0;
    mountList([provider({ slug: 'a' })], { onRefresh: () => { pressed += 1; } });

    const refresh = container.querySelector('button[aria-label="Refresh the provider list"]') as HTMLButtonElement;
    const add = container.querySelector('button[aria-label="Add provider"]') as HTMLButtonElement;
    expect(refresh).not.toBeNull();
    expect(add).not.toBeNull();
    // Same cluster, refresh first: the two controls act on the LIST, and the
    // panel header has one row for them.
    expect(refresh.parentElement).toBe(add.parentElement);

    act(() => refresh.click());
    expect(pressed).toBe(1);
  });

  test('the button spins and refuses a second press while the read is in flight', () => {
    mountList([provider({ slug: 'a' })], { isRefreshing: true });

    const refresh = container.querySelector('button[aria-label="Refresh the provider list"]') as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(refresh.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    // The rows stay on screen: a refresh must not blank a list being read.
    expect(rows().length).toBe(1);
  });

  test('the first read draws a spinner instead of an empty list', () => {
    mountList([], { isLoading: true });

    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('Reading providers');
    expect(status?.querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
    // "0 providers" over a spinner reads as a result, not as a wait.
    expect(container.textContent).toContain('Loading…');
    expect(container.textContent).not.toContain('0 providers');
    expect(rows().length).toBe(0);
  });

  test('an empty list that finished loading says so, with no spinner', () => {
    mountList([], { isLoading: false });

    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(container.textContent).toContain('No providers detected yet');
    expect(container.textContent).toContain('0 providers');
  });

  test('the refresh control is disabled while the first read runs', () => {
    mountList([], { isLoading: true });
    const refresh = container.querySelector('button[aria-label="Refresh the provider list"]') as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
  });
});
