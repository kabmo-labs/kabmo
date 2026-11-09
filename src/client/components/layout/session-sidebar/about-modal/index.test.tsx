/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The About card's FRAME, at both sizes.
 *
 * The phone used to get a full-bleed sheet (`h-full w-full`, no gutters), which
 * put the card's own header against the viewport's top edge — under the status
 * bar on a `viewport-fit: cover` surface — and capped the harness list at `46vh`
 * inside it, so the list scrolled while most of the screen sat empty below it.
 *
 * Two things are guarded here, and both are properties of the TREE rather than
 * of a stylesheet: the card is a bounded floating card sized by the same width
 * cap the composer's model picker uses, and the card carries exactly ONE scroll
 * container (its body) — the harness list must not be a second one.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { AboutModal } from '@/client/components/layout/session-sidebar/about-modal';
import { MAX_WIDTH } from '@/client/components/workspace/model-dropdown/popover-metrics';
import { resetHarnessVersions } from '@/client/hooks/models/use-harness-versions';
import { resetHarnessesStore } from '@/client/hooks/models/harness-catalog';
import { delay } from '@/client/hooks/chat/composer/file-reads';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';

/** A console with nothing to install: this suite reads the frame, not the data. */
const UPDATES: UseUpdatesResult = {
  info: null,
  checking: false,
  applying: null,
  progress: null,
  error: null,
  hasUpdate: false,
  check: async () => {},
  apply: async () => null,
};

const nativeFetch = globalThis.fetch;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // Both catalogs are module-level stores: a suite that ran earlier and left a
  // read in flight (or the "already loaded" flag set) makes this card mount
  // against that state instead of its own 501, and the harness list then renders
  // its skeleton forever — the frame assertions still pass, the ROWS assertion
  // does not. Cold stores make the suite order-independent.
  resetHarnessesStore();
  resetHarnessVersions();
  // The card reads two catalogs on mount; a 501 makes both hooks report their
  // error state instead of dialing a server that is not there.
  globalThis.fetch = (async () => ({
    ok: false,
    status: 501,
    json: async () => ({}),
  })) as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = nativeFetch;
  restoreDomGlobals();
});

let container: HTMLElement | null = null;

afterEach(() => {
  if (container) act(() => render(null, container!));
  container?.remove();
  container = null;
  for (const node of Array.from(document.body.children)) node.remove();
});

/** Mount the card and return its `role="dialog"` panel. */
async function mountCard(): Promise<HTMLElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => render(<AboutModal isOpen onClose={() => {}} updates={UPDATES} />, container!));
  // The two catalog reads land after the first paint; the harness list only
  // exists once the store reports it is done loading.
  await act(() => delay(0));
  const panel = document.querySelector('[role="dialog"][aria-label="About Kabmo"]');
  if (!panel) throw new Error('About card did not mount');
  return panel as HTMLElement;
}

describe('the About card frame', () => {
  test('a floating card sized by the model picker’s cap, not the whole screen', async () => {
    const panel = await mountCard();
    // `h-full` was the full-bleed sheet: a card stretched to the screen's top
    // edge is exactly what drew its header under the status bar.
    expect(panel.classList.contains('h-full')).toBe(false);
    expect(panel.style.getPropertyValue('--about-card-max')).toBe(`min(${MAX_WIDTH}px, 100%)`);
    expect(panel.classList.contains('max-h-full')).toBe(true);
    expect(panel.classList.contains('rounded-2xl')).toBe(true);
  });

  test('the card is centered with a capped height, never stretched', async () => {
    const panel = await mountCard();
    const backdrop = panel.parentElement!;
    // `items-stretch` + `h-full` was the sheet; a stretched card has no gutter to
    // keep the safe area clear, and no height cap to scroll inside.
    expect(backdrop.className).toContain('items-center');
    expect(backdrop.className).not.toContain('items-stretch');
    expect(panel.classList.contains('max-h-full')).toBe(true);
  });

  test('exactly ONE scroll container inside the card', async () => {
    const panel = await mountCard();
    const scrollers = panel.querySelectorAll('.scrollbar-overlay-container');
    expect(scrollers).toHaveLength(1);
    // …and the harness list is not it.
    const list = panel.querySelector('[data-harness-rows]');
    expect(list).not.toBeNull();
    expect(list!.classList.contains('scrollbar-overlay-container')).toBe(false);
    expect(list!.classList.contains('overflow-y-auto')).toBe(false);
  });
});
