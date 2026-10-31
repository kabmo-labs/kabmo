/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The narrow wiki nav: an outlined floating trigger opens the page list as a
 * modal, and reaching a page closes it.
 *
 * Three properties are pinned because each is invisible to a markup screenshot:
 * the trigger reports its open state (`aria-expanded`), Escape closes the modal
 * the reader opened (no other UI unmounts it), and a page click closes it too —
 * a modal left covering the page the reader just chose is the bug this pair
 * exists to avoid.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { WikiNavModal, WikiNavTrigger } from '@/client/components/workspace/wiki-panel/NavModal';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { WikiNavSection } from '@/shared/types/wiki';

const SECTIONS: WikiNavSection[] = [
  {
    title: 'Navigation',
    links: [
      { label: 'Home', target: 'Home', path: 'Home.md', url: null },
      { label: 'Deploying', target: 'Deploying', path: 'Deploying.md', url: null },
    ],
    notes: ['**Version**: 1.6.0'],
  },
];

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => render(node, container as HTMLElement));
  return container;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
    container = null;
  }
});

afterAll(() => {
  restoreDomGlobals();
});

describe('WikiNavTrigger', () => {
  test('is an outlined button that reports the state it opens', () => {
    let clicks = 0;
    const root = mount(<WikiNavTrigger open={false} onClick={() => { clicks += 1; }} />);
    const button = root.querySelector('button');

    expect(button).not.toBeNull();
    expect(button?.getAttribute('aria-expanded')).toBe('false');
    // Outline, not fill: the trigger floats over the document it belongs to.
    expect(button?.getAttribute('class')).toContain('border');

    act(() => button?.click());
    expect(clicks).toBe(1);
  });

  test('reports the modal as expanded while it is open', () => {
    const root = mount(<WikiNavTrigger open onClick={() => {}} />);
    expect(root.querySelector('button')?.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('WikiNavModal', () => {
  test('renders nothing while closed', () => {
    const root = mount(
      <WikiNavModal open={false} sections={SECTIONS} selected={null} onSelect={() => {}} onClose={() => {}} />,
    );
    expect(root.querySelector('[role="dialog"]')).toBeNull();
  });

  test('shows the wiki sections and closes when a page is chosen', () => {
    const selected: string[] = [];
    let closed = 0;
    const root = mount(
      <WikiNavModal
        open
        sections={SECTIONS}
        selected="Home.md"
        onSelect={(path) => selected.push(path)}
        onClose={() => { closed += 1; }}
      />,
    );

    const dialog = root.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-label')).toBe('Wiki pages');
    expect(dialog?.textContent).toContain('Navigation');
    expect(dialog?.textContent).toContain('1.6.0');

    const page = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []).find(
      (button) => button.textContent === 'Deploying',
    );
    expect(page).not.toBeNull();
    act(() => page?.click());

    expect(selected).toEqual(['Deploying.md']);
    expect(closed).toBe(1);
  });

  test('Escape closes the modal', () => {
    let closed = 0;
    mount(
      <WikiNavModal
        open
        sections={SECTIONS}
        selected={null}
        onSelect={() => {}}
        onClose={() => { closed += 1; }}
      />,
    );

    act(() => {
      document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(closed).toBe(1);
  });
});
