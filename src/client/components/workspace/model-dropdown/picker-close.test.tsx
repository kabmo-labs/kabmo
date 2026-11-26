/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The full-screen model picker's close control rides its FIRST row.
 *
 * The frame used to own a 36px header containing the word "Model" and an `X`,
 * above a 49px harness strip — two chrome rows on a phone where every other
 * surface has one, and a label naming what the user had just tapped. The frame
 * now draws no header, so the control lives on the picker's own first row. This
 * file pins that: the control exists, it sits inside the strip (not a header
 * band), and pressing it closes the picker.
 *
 * It is a separate file from `placement.test.tsx` because that one asserts the
 * FRAME (where it portals, what it draws) and mounting the panel needs the
 * catalog store stubbed, which would make the frame cases noisy.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Window } from 'happy-dom';

import { ModelDropdownPanel } from '@/client/components/workspace/model-dropdown/Panel';
import type { HarnessSummary } from '@kabmo-labs/kabmo-app-contracts/harness';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  installDomGlobals(win);
  (globalThis as unknown as Record<string, unknown>).ResizeObserver ??= NoopResizeObserver;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  document.querySelectorAll('[role="dialog"]').forEach((node) => node.remove());
  restoreDomGlobals();
});

/** A harness the tab strip can draw: the fields `harnessBlock` reads. */
function harness(id: string): HarnessSummary {
  return {
    id,
    label: id,
    transport: 'rpc',
    canLaunch: true,
    builtIn: true,
    enabled: true,
    command: id,
    probe: null,
  };
}

function mount(harnesses: HarnessSummary[], onClose: () => void): void {
  act(() =>
    render(
      h(ModelDropdownPanel, {
        search: '',
        onSearchChange: () => {},
        onAddProvider: () => {},
        isLoading: false,
        filteredModels: [],
        favoriteModels: [],
        recentModels: [],
        providerGroups: {},
        ambiguousNames: new Set<string>(),
        collapsedSections: {},
        onToggleCollapse: () => {},
        selectedModelKey: '',
        modelIndex: {},
        focusedIndex: -1,
        hoveredRow: null,
        onSelect: () => {},
        onToggleFavorite: () => {},
        onCycleThinking: () => {},
        onHoverItem: () => {},
        onMouseLeave: () => {},
        harnesses,
        activeHarness: 'omp-rpc',
        harnessEditable: true,
        onSelectHarness: () => {},
        onClose,
        fullscreen: true,
      }),
      container,
    ),
  );
}

describe('the full-screen picker close control', () => {
  test('it rides the harness strip, which is the frame’s first row', () => {
    mount([harness('omp-rpc')], () => {});
    const dialog = document.querySelector('[role="dialog"][aria-label="Select model"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    const close = dialog.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(close).not.toBeNull();
    // Inside the tab strip's row, not a band of its own.
    const strip = dialog.querySelector('[role="tablist"]') as HTMLElement;
    expect(strip).not.toBeNull();
    expect(close.closest('[role="tablist"]')).toBeNull();
    expect(close.parentElement?.parentElement?.contains(strip)).toBe(true);
    expect(dialog.querySelector('header')).toBeNull();
  });

  test('a picker with no harness tabs puts the control on the search row', () => {
    mount([], () => {});
    const dialog = document.querySelector('[role="dialog"][aria-label="Select model"]') as HTMLElement;
    const close = dialog.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(close).not.toBeNull();
    expect(dialog.querySelector('[role="tablist"]')).toBeNull();
    expect(dialog.querySelector('input[placeholder="Search models"]')).not.toBeNull();
  });

  test('pressing it closes the picker', () => {
    let closed = 0;
    mount([harness('omp-rpc')], () => {
      closed += 1;
    });
    const close = document.querySelector<HTMLButtonElement>(
      '[role="dialog"] button[aria-label="Close"]',
    );
    expect(close).not.toBeNull();
    act(() => close?.click());
    expect(closed).toBe(1);
  });
});
