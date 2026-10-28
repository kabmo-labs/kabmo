/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The four facts every plugin card is built from: version, author, origin and
 * slot badges.
 *
 * Each one has a failure mode that reads as a DIFFERENT true statement, which is
 * why they are pinned separately:
 *
 * - a version pair drawn for an equal version announces an update that changes
 *   nothing;
 * - an absent author rendered as nothing reads as a plugin with no author rather
 *   than one whose manifest does not say;
 * - an origin badge that guesses makes a clone look like a store install, which
 *   is the difference between "Kabmo keeps this current" and "you do";
 * - a declared slot drawn like a live one makes an author's claim read as a
 *   registration the host imported.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  AuthorLine,
  OriginBadge,
  SlotBadges,
  VersionLine,
} from '@/client/components/settings/categories/panel-plugins/Meta';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
});

afterEach(() => {
  if (container) render(null, container);
});

afterAll(() => {
  restoreDomGlobals();
});

/** Mount one element and return the container. */
function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

describe('VersionLine', () => {
  test('one number when nothing newer is known', () => {
    const el = mount(h(VersionLine, { version: '0.2.0' }));
    expect(el.textContent).toBe('v0.2.0');
    expect(el.textContent).not.toContain('→');
  });

  test('an equal latest version is not an update', () => {
    // The store publishes the same version the user runs. Drawing a pair here
    // would claim an update that changes nothing.
    const el = mount(h(VersionLine, { version: '0.2.0', latest: '0.2.0' }));
    expect(el.textContent).toBe('v0.2.0');
  });

  test('names both sides when the source is newer', () => {
    const el = mount(h(VersionLine, { version: '0.2.0', latest: '0.3.0' }));
    expect(el.textContent).toContain('v0.2.0');
    expect(el.textContent).toContain('v0.3.0');
    expect(el.textContent).toContain('→');
  });

  test('a plugin with no version says so rather than showing "v"', () => {
    expect(mount(h(VersionLine, { version: '' })).textContent).toBe('unversioned');
  });
});

describe('AuthorLine', () => {
  test('an absent author is stated, not silently dropped', () => {
    expect(mount(h(AuthorLine, { author: undefined })).textContent).toBe('author unknown');
  });

  test('a name with no URL is plain text', () => {
    const el = mount(h(AuthorLine, { author: { name: 'Acme' } }));
    expect(el.textContent).toBe('by Acme');
    expect(el.querySelector('a')).toBeNull();
  });

  test('a URL makes the credit a link', () => {
    const el = mount(h(AuthorLine, { author: { name: 'Acme', url: 'https://acme.example' } }));
    const link = el.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://acme.example');
    // An external link opens in a tab and must not hand over the opener.
    expect(link?.getAttribute('rel')).toContain('noreferrer');
    expect(el.textContent).toContain('by Acme');
  });
});

describe('OriginBadge', () => {
  test('each origin names where the code came from and who keeps it current', () => {
    expect(mount(h(OriginBadge, { origin: 'bundled' })).textContent).toBe('Bundled');
    expect(mount(h(OriginBadge, { origin: 'git' })).textContent).toBe('Git');
    expect(mount(h(OriginBadge, { origin: 'local' })).textContent).toBe('Local');
  });

  test('the detail is in the title, so the distinction is readable without a click', () => {
    const el = mount(h(OriginBadge, { origin: 'git' }));
    expect(el.querySelector('[title]')?.getAttribute('title')).toContain('git clone');
  });
});

describe('SlotBadges', () => {
  const item = { key: 'rightPanel', label: 'Right panel', detail: 'A view in the right column.', kind: 'panel' as const, count: 1 };

  test('a live registration is a solid badge', () => {
    const el = mount(h(SlotBadges, { items: [item], declared: false }));
    const badge = el.querySelector('span');
    expect(badge?.className).not.toContain('border-dashed');
    expect(badge?.getAttribute('title')).not.toContain('declared');
  });

  test('a declared-only slot is dashed AND says so in its title', () => {
    // A claim drawn like a fact is the one thing this must not do.
    const el = mount(h(SlotBadges, { items: [item], declared: true }));
    const badge = el.querySelector('span');
    expect(badge?.className).toContain('border-dashed');
    expect(badge?.getAttribute('title')).toContain('declared by the manifest');
  });

  test('a count above one is shown, so four actions do not look like one', () => {
    const el = mount(h(SlotBadges, { items: [{ ...item, count: 4 }], declared: false }));
    expect(el.textContent).toContain('×4');
  });

  test('nothing to show renders nothing', () => {
    expect(mount(h(SlotBadges, { items: [], declared: false })).textContent).toBe('');
  });
});
