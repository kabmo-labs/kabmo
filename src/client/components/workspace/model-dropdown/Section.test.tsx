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

function mountSection(): void {
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
        focusedIndex: -1,
        onSelect: () => {},
        onToggleFavorite: () => {},
        onCycleThinking: () => {},
        onHoverItem: () => {},
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
});
