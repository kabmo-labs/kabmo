/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
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

function mountList(providers: ProviderItem[]): void {
  act(() => {
    render(
      h(ProviderSidebarList, {
        providers,
        selectedProviderId: providers[0]?.id ?? '',
        onSelectProvider: () => {},
        onOpenAddModal: () => {},
        onDeleteProvider: () => {},
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
  test('the name takes the slack, so the trailing columns are fixed', () => {
    mountList([
      provider({ slug: 'a', name: 'A' }),
      provider({ slug: 'b', name: 'A much longer provider name than the first' }),
    ]);

    for (const row of rows()) {
      const [plate, name, dot, count] = [...row.children] as HTMLElement[];
      // The plate is a fixed box whatever the mark is (svg or initials pill).
      expect(plate.style.width).toBe('22px');
      expect(plate.style.height).toBe('22px');
      // The name is what absorbs the difference between short and long names.
      expect(name.className).toContain('flex-1');
      expect(name.className).toContain('truncate');
      // Both trailing slots are fixed, so dot and count share one column.
      expect(dot.className).toContain('w-2');
      expect(count.className).toContain('w-8');
      expect(count.className).toContain('text-right');
      expect(count.className).toContain('tabular-nums');
    }
  });

  test('the delete slot is reserved on a row that has no delete', () => {
    // A provider omp merely discovered cannot be deleted; before the slot was
    // reserved, those rows' counts sat 24px to the right of everyone else's.
    mountList([
      provider({ slug: 'native', inModelsYml: true }),
      provider({ slug: 'discovered', status: 'connected' }),
    ]);

    const wrappers = [...container.querySelectorAll('div.group\\/row')] as HTMLElement[];
    expect(wrappers).toHaveLength(2);
    for (const wrapper of wrappers) {
      const slot = wrapper.lastElementChild as HTMLElement;
      expect(slot.className).toContain('w-6');
      expect(slot.className).toContain('shrink-0');
    }
    // Only the deletable one actually carries the button.
    expect(container.querySelectorAll('button[aria-label^="Delete "]')).toHaveLength(1);
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

    const counts = rows().map((row) => row.children[3].textContent);
    expect(counts).toEqual(['109', '0']);
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
