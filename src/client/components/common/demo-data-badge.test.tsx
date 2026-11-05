/**
 * Demo data is stated, never implied.
 *
 * `MOCK=true` boots the server on bundled sample sessions. Measured in that
 * mode, the drawer listed real-looking session titles and the timeline rendered
 * a 39-card transcript, with no marker anywhere in the shell: only two panels
 * deep in Settings said "Mock", and both were off screen. A demo instance was
 * therefore indistinguishable from a real one, which is the failure R-38 names.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';

import { DemoDataBadge } from '@/client/components/common/DemoDataBadge';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let container: HTMLElement;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (nativeGlobals[key] === undefined) delete target[key];
    else target[key] = nativeGlobals[key];
  }
});

afterEach(() => render(null, container));

describe('DemoDataBadge', () => {
  test('the strip says what the data is, not just that something is on', () => {
    render(h(DemoDataBadge, { variant: 'strip' }), container);
    const strip = container.querySelector('[role="status"]')!;
    expect(strip).not.toBeNull();
    // "Demo" alone leaves the reader guessing whether it means data, mode or a
    // product tier. The sentence names the fact: nothing came from a session.
    expect(strip.textContent).toContain('nothing here comes from a real session');
  });

  test('the inline chip carries the same explanation in its title', () => {
    render(h(DemoDataBadge, { variant: 'inline' }), container);
    const chip = container.querySelector('span[title]')!;
    expect(chip.textContent).toBe('Demo');
    expect(chip.getAttribute('title')).toContain('nothing here comes from a real session');
  });
});
