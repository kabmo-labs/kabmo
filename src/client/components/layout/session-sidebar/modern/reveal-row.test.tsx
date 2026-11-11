/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `modern` sidebar's reveal row.
 *
 * Two controls, never one toggle: the window is truncated for height, so a
 * partial reveal must leave both "N more" and "Less" reachable. A single
 * alternating control strands the user after the first reveal — the bug this
 * row exists to prevent.
 *
 * Rendered with `h()` against happy-dom, following
 * `modern/workspace-header.test.tsx`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { WorkspaceRevealRow } from '@/client/components/layout/session-sidebar/modern/RevealRow';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'MouseEvent'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

function mount(props: { hiddenCount: number; canShowLess: boolean; onShowMore?: () => void; onShowLess?: () => void }) {
  if (container) {
    render(null, container);
    container.remove();
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  render(
    h(WorkspaceRevealRow, {
      onShowMore: () => {},
      onShowLess: () => {},
      ...props,
    }),
    container,
  );
  return container.firstElementChild as HTMLElement | null;
}

const buttons = () => Array.from(container.querySelectorAll('button'));

describe('modern workspace reveal row', () => {
  test('it renders nothing when every row is already visible', () => {
    expect(mount({ hiddenCount: 0, canShowLess: false })).toBeNull();
  });

  test('it names the hidden row count on the reveal control', () => {
    mount({ hiddenCount: 4, canShowLess: false });
    expect(buttons()).toHaveLength(1);
    expect(buttons()[0]!.textContent).toContain('4 more');
  });

  test('a partial reveal keeps both controls on screen', () => {
    mount({ hiddenCount: 2, canShowLess: true });
    const labels = buttons().map((button) => button.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('2 more');
    expect(labels[1]).toContain('Less');
  });

  test('each control calls its own handler', () => {
    const calls: string[] = [];
    mount({
      hiddenCount: 1,
      canShowLess: true,
      onShowMore: () => calls.push('more'),
      onShowLess: () => calls.push('less'),
    });
    const [more, less] = buttons();
    more!.click();
    expect(calls).toEqual(['more']);
    less!.click();
    expect(calls).toEqual(['more', 'less']);
  });
});
