/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The section header's two columns.
 *
 * Measured in the browser before the fix: the header padded itself with an
 * EMPTY grip slot so its title lined up with the model NAMES, which put the
 * provider mark one column right of the rows' drag handles (mark at `x=349`,
 * grips at `x=323`). Two icon columns that close together read as two lists.
 *
 * The header now starts IN the grip column — its mark occupies the same 18px
 * slot the rows keep for the handle — and its title lands on the rows' plate
 * column. happy-dom has no layout, so the columns are pinned by the slot they
 * are built from rather than by a measured x; the pixel check is in the wiki.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ModelDropdownSection } from '@/client/components/workspace/model-dropdown/Section';
import { buildPickerGroups } from '@/client/components/workspace/model-dropdown/groups';
import { modelKey } from '@/shared/lib/models/identity';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { AIModelOption } from '@/shared/types';

const MODELS: AIModelOption[] = [{ id: 'v3', name: 'DeepSeek V3', provider: 'deepseek' }];

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

function mountSection(overrides: Partial<Parameters<typeof ModelDropdownSection>[0]> = {}): void {
  act(() => {
    render(
      h(ModelDropdownSection, {
        id: 'DEEPSEEK',
        title: 'DEEPSEEK',
        models: MODELS,
        isCollapsed: false,
        onToggleCollapse: () => {},
        selectedModelKey: '',
        modelIndex: {},
        ambiguousNames: new Set<string>(),
        focusedIndex: -1,
        onSelect: () => {},
        onToggleFavorite: () => {},
        onCycleThinking: () => {},
        onHoverItem: () => {},
        ...overrides,
      }),
      container,
    );
  });
}

/** The section header: the first button, the only one with the uppercase label. */
function header(): HTMLElement {
  return container.querySelector('button') as HTMLElement;
}

describe('model picker section header columns', () => {
  test('the mark takes the grip column instead of an empty spacer', () => {
    mountSection();

    const mark = header().firstElementChild?.firstElementChild as HTMLElement | null;
    expect(mark).not.toBeNull();
    // The mark is the FIRST slot — a spacer here would push it a column right.
    // `ProviderIconPlate` sizes itself inline, so the width is a style, not a class.
    expect(mark?.style.width).toBe('18px');
    expect(mark?.querySelector('svg, img')).not.toBeNull();
  });

  test('the title sits directly after the mark, on the rows’ plate column', () => {
    mountSection();

    const title = Array.from(header().querySelectorAll('span')).find(
      (span) => (span.textContent ?? '').trim() === 'DEEPSEEK' && !span.querySelector('svg, img'),
    ) as HTMLElement | undefined;
    expect(title).toBeDefined();
    // Nothing between them: the header has exactly two columns.
    expect(title?.previousElementSibling?.querySelector('svg, img')).not.toBeNull();
  });

  test('the header mark and the row grip slot are the same column width', () => {
    mountSection();

    const markSlot = header().firstElementChild?.firstElementChild as HTMLElement;
    const row = container.querySelector('[role="button"]') as HTMLElement;
    const gripSlot = row.querySelector('span') as HTMLElement;

    // One width for both, or the mark stops centring on the handles.
    expect(markSlot.style.width).toBe('18px');
    expect(gripSlot.className).toContain('w-[18px]');
    expect(gripSlot.className).toContain('justify-center');
    expect(gripSlot.querySelector('svg')).not.toBeNull();
  });

  test('the chevron is built from the same slot as a row’s star', () => {
    mountSection();

    // Measured before this: the bare chevron sat flush on the panel edge, its
    // centre 4.5px right of every favourite star below it (675 vs 670.5).
    const chevronSlot = header().lastElementChild as HTMLElement;
    const starButton = container.querySelector('button[title*="favorites"]') as HTMLElement;

    expect(chevronSlot.className).toContain('p-1');
    expect(chevronSlot.className).toContain('justify-center');
    expect(starButton.className).toContain('p-1');
    expect(chevronSlot.querySelector('svg')).not.toBeNull();
  });

  test('a row carries its row id, which the specs card anchors to', () => {
    mountSection();

    // Without this the card has no row to sit beside and falls back to the
    // panel's own top — the drift that made it describe a model rows away. The
    // anchor is the ROW, not the model: one model is drawn twice.
    const row = container.querySelector('[role="button"]') as HTMLElement;
    expect(row.getAttribute('data-picker-row')).toBe(`DEEPSEEK::${modelKey(MODELS[0])}`);
  });
});

describe('model picker rail rows and the provider tag', () => {
  const SHARED: AIModelOption[] = [
    { id: 'v4-pro', name: 'DeepSeek V4 Pro', provider: 'deepseek' },
    { id: 'v4-pro', name: 'DeepSeek V4 Pro', provider: 'kenari' },
  ];

  /** The provider tag is the only `span` whose text is a bare provider slug. */
  function tags(): HTMLElement[] {
    return Array.from(container.querySelectorAll('[role="button"] span')).filter(
      (span) => (span.getAttribute('title') ?? '').startsWith('Provider: '),
    ) as HTMLElement[];
  }

  test('a rail row tags a name that two providers serve', () => {
    mountSection({ id: 'favorites', title: 'FAVORITES', iconType: 'star', models: SHARED, ambiguousNames: new Set(['deepseek v4 pro']) });

    const rendered = tags().map((tag) => tag.textContent);
    expect(rendered).toEqual(['deepseek', 'kenari']);
  });

  test('a rail row stays untagged when the name is unique to one provider', () => {
    mountSection({ id: 'recent', title: 'RECENT', iconType: 'recent', ambiguousNames: new Set() });

    expect(tags()).toEqual([]);
  });

  test('a provider section never tags a row — its header already says so', () => {
    // The same rows, drawn under the DEEPSEEK heading: a tag here would repeat
    // the section title on every line.
    mountSection({ models: SHARED, ambiguousNames: new Set(['deepseek v4 pro']) });

    expect(tags()).toEqual([]);
  });

  test('the tag never shrinks or wraps, so `kenari` and `kenari-jatis` stay distinguishable', () => {
    mountSection({
      id: 'recent',
      title: 'RECENT',
      iconType: 'recent',
      models: [{ id: 'x', name: 'Shared', provider: 'kenari-jatis' }],
      ambiguousNames: new Set(['shared']),
    });

    const [tag] = tags();
    expect(tag?.className).toContain('shrink-0');
    expect(tag?.className).toContain('whitespace-nowrap');
    // The name is the only cell that gives up width.
    const name = container.querySelector('[role="button"] span[title^="Shared"]') as HTMLElement;
    expect(name.className).toContain('truncate');
    expect(name.getAttribute('title')).toBe('Shared · kenari-jatis');
  });

  test('each row anchors on its own id, not on the model it shows', () => {
    mountSection({ id: 'favorites', title: 'FAVORITES', iconType: 'star', models: SHARED.slice(0, 1) });

    const row = container.querySelector('[role="button"][data-picker-row]') as HTMLElement;
    expect(row.getAttribute('data-picker-row')).toBe('favorites::deepseek:v4-pro');
  });

  test('the rail copy and the provider copy of one model report different rows', () => {
    // The end-to-end shape of the bug: a favorite is drawn in the rail and again
    // under its provider, and before row ids the two resolved to one index — so
    // ArrowDown stepped over the rail and both rows highlighted together.
    const groups = buildPickerGroups(SHARED, '', {}, ['deepseek:v4-pro'], []);
    const hovered: number[] = [];
    const onHoverItem = (index: number) => hovered.push(index);

    act(() => {
      render(
        h(ModelDropdownSection, {
          id: 'favorites',
          title: 'FAVORITES',
          iconType: 'star',
          models: groups.favorites,
          isCollapsed: false,
          onToggleCollapse: () => {},
          selectedModelKey: '',
          modelIndex: groups.index,
          ambiguousNames: groups.ambiguousNames,
          focusedIndex: -1,
          onSelect: () => {},
          onToggleFavorite: () => {},
          onCycleThinking: () => {},
          onHoverItem,
        }),
        container,
      );
    });

    // happy-dom has no `MouseEvent` on the test global, so the event comes off
    // the document's own view; Preact proxies `onMouseEnter` through `mouseover`.
    const view = container.ownerDocument.defaultView as unknown as {
      Event: new (type: string, init: { bubbles: boolean }) => Event;
    };
    const row = container.querySelector('[role="button"][data-picker-row]') as HTMLElement;
    act(() => {
      row.dispatchEvent(new view.Event('mouseover', { bubbles: true }));
      row.dispatchEvent(new view.Event('mouseenter', { bubbles: false }));
    });

    expect(hovered).toEqual([0]);
    // …and the provider section's copy of the same model is a different index.
    expect(groups.index['DEEPSEEK::deepseek:v4-pro']).not.toBe(0);
  });
});
