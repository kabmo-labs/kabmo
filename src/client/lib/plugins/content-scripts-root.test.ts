/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ROOT element a content script is handed — the CSS half of the contract.
 *
 * A plugin's stylesheet is served wrapped in
 * `@scope ([data-plugin-surface="<id>"])`, so DOM appended OUTSIDE that element
 * is unreachable by the plugin's own CSS. The failure is silent — an unstyled
 * script — which is why the host hands the root over and these assertions exist.
 *
 * The lifecycle rules (exact-once disposal, replacement, abort) are the subject
 * of `content-scripts.test.ts`; this file owns only the element and its
 * lifetime.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { ContentScriptContext, ContentScriptRegistration } from '@kabmo-labs/kabmo-sdk';
import { mountContentScripts, resetContentScripts, unmountContentScripts } from '@/client/lib/plugins/content-scripts';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
let window_: Window | null = null;

function installDom(): void {
  window_ = new Window();
  const target = globalThis as unknown as Record<string, unknown>;
  const source = window_ as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    if (source[key] !== undefined) target[key] = source[key];
  }
}

function restoreDom(): void {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    const value = nativeGlobals[key];
    if (value === undefined) delete target[key];
    else target[key] = value;
  }
  window_ = null;
}

/** The host every mount in this suite is given. */
const host = { target: () => document.body };

/** A script that appends a node and removes it on disposal. */
function marker(id: string, log: string[]): ContentScriptRegistration {
  return {
    id,
    mount: (context: ContentScriptContext) => {
      log.push(`mount:${id}:${context.generation}`);
      const node = document.createElement('div');
      node.id = `script-${id}`;
      node.dataset.generation = String(context.generation);
      document.body.appendChild(node);
      return () => {
        log.push(`dispose:${id}`);
        node.remove();
      };
    },
  };
}

beforeEach(() => {
  installDom();
  resetContentScripts();
  document.body.replaceChildren();
});

afterEach(() => {
  resetContentScripts();
  restoreDom();
});

describe('the scoped root', () => {
  test('the mount is handed a root carrying the plugin scope attribute', async () => {
    let seen: HTMLElement | undefined;
    await mountContentScripts(
      'demo',
      [{ id: 'r', mount: (context) => {
        seen = context.root;
        return () => {};
      } }],
      host,
    );

    expect(seen).toBeDefined();
    expect(seen?.getAttribute('data-plugin-surface')).toBe('demo');
    // In the document, so a node the script appends to it is rendered.
    expect(document.body.contains(seen!)).toBe(true);
  });

  test('the root generates no box, so it does not disturb the host layout', async () => {
    let seen: HTMLElement | undefined;
    await mountContentScripts(
      'demo',
      [{ id: 'r', mount: (context) => {
        seen = context.root;
        return () => {};
      } }],
      host,
    );
    expect(seen?.style.display).toBe('contents');
  });

  test('teardown removes the whole root subtree, including a node the script never removed', async () => {
    // The contract's payoff: a script that leaves its node in the root needs no
    // removal of its own, because the host takes the subtree with it.
    await mountContentScripts(
      'demo',
      [{ id: 'r', mount: (context) => {
        context.root.appendChild(document.createElement('div'));
        return () => {};
      } }],
      host,
    );
    expect(document.querySelectorAll('[data-plugin-surface="demo"]')).toHaveLength(1);

    await unmountContentScripts('demo');

    expect(document.querySelectorAll('[data-plugin-surface="demo"]')).toHaveLength(0);
    expect(document.body.innerHTML).toBe('');
  });

  test('a remount replaces the root rather than accumulating one per generation', async () => {
    await mountContentScripts('demo', [marker('a', [])], host);
    await mountContentScripts('demo', [marker('a', [])], host);
    expect(document.querySelectorAll('[data-plugin-surface="demo"]')).toHaveLength(1);
  });

  test('two plugins keep their own roots, and one teardown leaves the other', async () => {
    await mountContentScripts('alpha', [marker('a', [])], host);
    await mountContentScripts('beta', [marker('b', [])], host);

    await unmountContentScripts('alpha');

    expect(document.querySelector('[data-plugin-surface="alpha"]')).toBeNull();
    expect(document.querySelector('[data-plugin-surface="beta"]')).not.toBeNull();
  });

  test('a registration list that mounted nothing leaves no root behind', async () => {
    // Every registration threw, so no generation exists — an empty root would be
    // inert, but the document should not claim the plugin is live.
    await mountContentScripts(
      'demo',
      [{ id: 'boom', mount: () => {
        throw new Error('nope');
      } }],
      host,
    );
    expect(document.querySelector('[data-plugin-surface="demo"]')).toBeNull();
  });
});
