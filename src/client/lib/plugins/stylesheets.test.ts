/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The plugin stylesheet lifecycle.
 *
 * The property this suite exists for is the one that makes `css` in a manifest
 * mean anything: a plugin's imported stylesheet is emitted beside its bundle
 * and referenced by nothing, so it is INERT until the host loads it. Loading it
 * is therefore the whole feature, and every rule below is a silent bug when it
 * is wrong:
 *
 * - A rebuilt plugin reaches a NEW content-addressed URL, and the old `<link>`
 *   must go — CSS is not scoped, so two versions of one plugin's rules would
 *   both apply.
 * - A plugin that is disabled or removed must lose its `<link>`, or a
 *   switched-off plugin keeps styling the document.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import {
  loadPluginStylesheet,
  reconcilePluginStylesheets,
  resetPluginStylesheets,
  unloadPluginStylesheet,
} from '@/client/lib/plugins/stylesheets';

const DOM_GLOBALS = ['window', 'document', 'Node', 'Element', 'HTMLElement'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

/** Every plugin `<link>` currently in the document. */
function links(): HTMLLinkElement[] {
  return [...document.head.querySelectorAll<HTMLLinkElement>('link[data-plugin-stylesheet]')];
}

function hrefOf(pluginId: string): string | undefined {
  return document.head.querySelector<HTMLLinkElement>(`link[data-plugin-stylesheet="${pluginId}"]`)?.getAttribute('href') ?? undefined;
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    nativeGlobals[key] = target[key];
    const value = (win as unknown as Record<string, unknown>)[key];
    if (value !== undefined) target[key] = value;
  }
  resetPluginStylesheets();
  document.head.replaceChildren();
});

afterEach(() => {
  resetPluginStylesheets();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
});

describe('loading', () => {
  test('a stylesheet reaches the document head', () => {
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=abc');
    const link = links();
    expect(link).toHaveLength(1);
    expect(link[0]?.getAttribute('href')).toBe('/api/panels/css/demo.css?v=abc');
    expect(link[0]?.rel).toBe('stylesheet');
  });

  test('re-applying the SAME url does not add a second link', () => {
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=abc');
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=abc');
    expect(links()).toHaveLength(1);
  });

  test('a REBUILD replaces the link rather than adding one', () => {
    // The content hash is what makes a rebuild a new URL; the old rules must
    // not linger, because CSS is not scoped.
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=one');
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=two');

    expect(links()).toHaveLength(1);
    expect(hrefOf('demo')).toBe('/api/panels/css/demo.css?v=two');
  });

  test('two plugins keep their own links', () => {
    loadPluginStylesheet('alpha', '/api/panels/css/alpha.css?v=1');
    loadPluginStylesheet('beta', '/api/panels/css/beta.css?v=1');
    expect(links()).toHaveLength(2);
  });
});

describe('unloading', () => {
  test('unloading one plugin leaves the other alone', () => {
    loadPluginStylesheet('alpha', '/api/panels/css/alpha.css?v=1');
    loadPluginStylesheet('beta', '/api/panels/css/beta.css?v=1');

    unloadPluginStylesheet('alpha');

    expect(hrefOf('alpha')).toBeUndefined();
    expect(hrefOf('beta')).toBe('/api/panels/css/beta.css?v=1');
  });

  test('unloading twice is harmless', () => {
    loadPluginStylesheet('demo', '/api/panels/css/demo.css?v=1');
    unloadPluginStylesheet('demo');
    unloadPluginStylesheet('demo');
    expect(links()).toHaveLength(0);
  });
});

describe('reconcile', () => {
  test('a plugin that disappears from the list loses its stylesheet', () => {
    // This is the disable/remove path: the registry payload is the whole truth
    // about which plugins are live, and CSS is not scoped.
    reconcilePluginStylesheets([
      { pluginId: 'alpha', cssUrl: '/api/panels/css/alpha.css?v=1' },
      { pluginId: 'beta', cssUrl: '/api/panels/css/beta.css?v=1' },
    ]);
    expect(links()).toHaveLength(2);

    reconcilePluginStylesheets([{ pluginId: 'alpha', cssUrl: '/api/panels/css/alpha.css?v=1' }]);

    expect(hrefOf('alpha')).toBe('/api/panels/css/alpha.css?v=1');
    expect(hrefOf('beta')).toBeUndefined();
  });

  test('a plugin with no cssUrl contributes no link', () => {
    // A plugin that renders only into a slot uses the host's utilities; it must
    // not get a link at all, or every install would carry a 404 in the console.
    reconcilePluginStylesheets([
      { pluginId: 'withcss', cssUrl: '/api/panels/css/withcss.css?v=1' },
      { pluginId: 'nocss' },
    ]);

    expect(links()).toHaveLength(1);
    expect(hrefOf('nocss')).toBeUndefined();
  });

  test('an empty list clears every stylesheet', () => {
    reconcilePluginStylesheets([{ pluginId: 'alpha', cssUrl: '/api/panels/css/alpha.css?v=1' }]);
    reconcilePluginStylesheets([]);
    expect(links()).toHaveLength(0);
  });

  test('a rebuild through reconcile swaps the URL, not the link count', () => {
    reconcilePluginStylesheets([{ pluginId: 'alpha', cssUrl: '/api/panels/css/alpha.css?v=1' }]);
    reconcilePluginStylesheets([{ pluginId: 'alpha', cssUrl: '/api/panels/css/alpha.css?v=2' }]);

    expect(links()).toHaveLength(1);
    expect(hrefOf('alpha')).toBe('/api/panels/css/alpha.css?v=2');
  });
});
