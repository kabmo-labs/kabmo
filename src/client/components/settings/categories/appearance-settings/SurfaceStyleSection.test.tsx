/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Surfaces" — the two material cards, and the reason the frost is missing when
 * it is.
 *
 * The notice is the point of this file. `glass.css` silently hands back opaque
 * panels on an engine without `backdrop-filter` and under
 * `prefers-reduced-transparency`, and a CSS fallback cannot say why — so a
 * window whose setting reads `glass` and whose material is `classic` is
 * indistinguishable from a broken setting on that device (measured: Chromium
 * supports both, so the notice correctly renders nothing there; the copy paths
 * are what is pinned here).
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { SurfaceStyleSection } from '@/client/components/settings/categories/appearance-settings/SurfaceStyleSection';
import { GLASS_LIMIT_COPY } from '@/shared/lib/theme/glass-support';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { SettingsState } from '@/shared/types';

let container: HTMLElement;
let backdropFilter = true;
let reducedTransparency = false;

/**
 * `CSS` is the one browser global the hook reads that `installDomGlobals` does not
 * install (it lists constructors, and `CSS.supports` is a namespace object), so
 * this file states it explicitly and removes it again.
 */
const realCss = globalThis.CSS;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The probe asks the platform; here the platform is a stub, so each case can
  // state what an engine/OS would answer.
  globalThis.CSS = {
    supports: (property: string) =>
      property === 'backdrop-filter' || property === '-webkit-backdrop-filter'
        ? backdropFilter
        : window.CSS.supports(property),
  } as unknown as typeof CSS;
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-transparency') ? reducedTransparency : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  backdropFilter = true;
  reducedTransparency = false;
});

afterAll(() => {
  if (realCss === undefined) delete (globalThis as { CSS?: unknown }).CSS;
  else globalThis.CSS = realCss;
  restoreDomGlobals();
});

function mount(surfaceStyle: SettingsState['surfaceStyle']): HTMLElement {
  container = document.body.appendChild(document.createElement('div'));
  act(() =>
    render(
      h(SurfaceStyleSection, {
        settings: { surfaceStyle } as SettingsState,
        onUpdate: () => {},
      }),
      container,
    ),
  );
  return container;
}

describe('surface style section', () => {
  test('a supported engine on glass shows no notice', () => {
    const el = mount('glass');
    expect(el.querySelector('[aria-live="polite"]')).toBeNull();
  });

  test('an engine without backdrop blur says so instead of pretending', () => {
    backdropFilter = false;
    const el = mount('glass');
    const notice = el.querySelector('[aria-live="polite"]');
    expect(notice?.textContent).toContain(GLASS_LIMIT_COPY['no-backdrop-filter']);
  });

  test('the system asking for less transparency is named, and glass is still the choice', () => {
    reducedTransparency = true;
    const el = mount('glass');
    expect(el.querySelector('[aria-live="polite"]')?.textContent).toContain(
      GLASS_LIMIT_COPY['reduced-transparency'],
    );
    // The cards still work: the limit is a REPORT, not a disabled control — the
    // stored choice is the user's, and it takes effect again the moment the OS
    // setting changes.
    expect(el.querySelector('[aria-pressed="true"]')?.textContent).toContain('Glass');
  });

  test('classic never carries the notice, because it has nothing to explain', () => {
    backdropFilter = false;
    reducedTransparency = true;
    const el = mount('classic');
    expect(el.querySelector('[aria-live="polite"]')).toBeNull();
  });
});
