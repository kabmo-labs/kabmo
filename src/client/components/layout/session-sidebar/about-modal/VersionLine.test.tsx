/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The version line is the row a reader looks at to learn what is running, so
 * the release-notes control belongs to that row and must be addressable by the
 * product it opens — not by a generic "Info" name that would make the two lines
 * indistinguishable to a screen reader or a spec.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { VersionLine } from '@/client/components/layout/session-sidebar/about-modal/VersionLine';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

function mount(label: string, notesLabel: string, onNotes: () => void): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() =>
    render(h(VersionLine, { label, notesLabel, onNotes }), container),
  );
  return container;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  restoreDomGlobals();
});

describe('VersionLine', () => {
  test('shows the version text beside a circle-i control named for its product', () => {
    const el = mount('Kabmo v0.17.0', "What's new in Kabmo", () => {});

    expect(el.textContent).toBe('Kabmo v0.17.0');
    const button = el.querySelector('button');
    expect(button?.getAttribute('aria-label')).toBe("What's new in Kabmo");
    expect(button?.getAttribute('title')).toBe("What's new in Kabmo");
    expect(button?.querySelector('svg')).not.toBeNull();
  });

  test('the control opens that product’s notes', () => {
    let opened = 0;
    const el = mount('Oh-My-Pi 18.14.0', "What's new in Oh-My-Pi", () => {
      opened += 1;
    });

    act(() => {
      el.querySelector('button')?.dispatchEvent(new window.Event('click', { bubbles: true }));
    });

    expect(opened).toBe(1);
  });
});