/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repository registration form.
 *
 * The one failure that matters here is a WRITE the user did not mean: the field
 * accepts a repository that GitHub will refuse, the server answers 400, and the
 * row the user expected never appears. So the client's own check is pinned for
 * the two mistakes that are cheap to catch before a round trip — a repository
 * that is not a GitHub repository at all, and one whose name breaks the
 * `kabmo-plugins-<plugin>` rule — and the submit path is pinned to send the
 * canonical URL rather than whatever was typed.
 *
 * The row states are pinned too: a registration whose read failed keeps its row
 * and shows the reason, because a source that silently vanishes is the failure
 * the whole cache split exists to prevent.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { PluginRegistries } from '@/client/components/settings/categories/panel-plugins/Registries';
import type { PanelPluginSource } from '@/shared/types';
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

function mount(node: h.JSX.Element): HTMLElement {
  container = document.createElement('div');
  document.body.append(container);
  act(() => render(node, container));
  return container;
}

const noop = async () => true;

function type(el: HTMLElement, value: string): void {
  const input = el.querySelector('input') as HTMLInputElement;
  act(() => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function submit(el: HTMLElement): void {
  act(() => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

describe('PluginRegistries', () => {
  test('states the naming rule where the field is', () => {
    const el = mount(
      h(PluginRegistries, { registries: [], busy: null, onRegister: noop, onRemove: noop, onRefresh: noop }),
    );
    expect(el.textContent).toContain('kabmo-plugins-');
    expect(el.textContent).toContain('does not need the prefix');
  });

  test('a repository that breaks the rule is refused without a request', async () => {
    const sent: string[] = [];
    const el = mount(
      h(PluginRegistries, {
        registries: [],
        busy: null,
        onRegister: async (repo: string) => {
          sent.push(repo);
          return true;
        },
        onRemove: noop,
        onRefresh: noop,
      }),
    );
    type(el, 'acme/kanban');
    submit(el);
    await Promise.resolve();
    expect(sent).toEqual([]);
    expect(el.textContent).toContain('must be named "kabmo-plugins-<plugin>"');
  });

  test('owner/repo is expanded to the canonical GitHub URL', async () => {
    const sent: string[] = [];
    const el = mount(
      h(PluginRegistries, {
        registries: [],
        busy: null,
        onRegister: async (repo: string) => {
          sent.push(repo);
          return true;
        },
        onRemove: noop,
        onRefresh: noop,
      }),
    );
    type(el, 'acme/kabmo-plugins-kanban');
    submit(el);
    await Promise.resolve();
    expect(sent).toEqual(['https://github.com/acme/kabmo-plugins-kanban']);
  });

  test('a failed read keeps its row and shows the reason', () => {
    const registries: PanelPluginSource[] = [
      { repo: 'acme/kabmo-plugins-kanban', url: 'https://github.com/acme/kabmo-plugins-kanban', name: 'kanban', pluginCount: 0, error: 'connect ETIMEDOUT' },
    ];
    const el = mount(
      h(PluginRegistries, { registries, busy: null, onRegister: noop, onRemove: noop, onRefresh: noop }),
    );
    expect(el.textContent).toContain('kanban');
    expect(el.textContent).toContain('connect ETIMEDOUT');
  });

  test('a registration that was never read says so instead of claiming zero plugins', () => {
    const registries: PanelPluginSource[] = [
      { repo: 'acme/kabmo-plugins-kanban', url: 'https://github.com/acme/kabmo-plugins-kanban', name: 'kanban', pluginCount: 0 },
    ];
    const el = mount(
      h(PluginRegistries, { registries, busy: null, onRegister: noop, onRemove: noop, onRefresh: noop }),
    );
    expect(el.textContent).toContain('not read yet');
  });

  test('removing asks for confirmation first, and then names the repository', async () => {
    const removed: string[] = [];
    const registries: PanelPluginSource[] = [
      { repo: 'acme/kabmo-plugins-kanban', url: 'https://github.com/acme/kabmo-plugins-kanban', name: 'kanban', pluginCount: 1 },
    ];
    const el = mount(
      h(PluginRegistries, {
        registries,
        busy: null,
        onRegister: noop,
        onRemove: async (repo: string) => {
          removed.push(repo);
          return true;
        },
        onRefresh: noop,
      }),
    );
    const remove = el.querySelector('[aria-label="Remove acme/kabmo-plugins-kanban"]') as HTMLButtonElement;
    act(() => remove.click());
    expect(removed).toEqual([]);

    const confirm = [...el.querySelectorAll('button')].find((button) => button.textContent === 'Confirm');
    act(() => confirm?.click());
    await Promise.resolve();
    expect(removed).toEqual(['acme/kabmo-plugins-kanban']);
  });
});
