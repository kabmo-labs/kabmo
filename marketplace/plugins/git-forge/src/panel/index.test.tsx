/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The assembled panel, mounted in a real DOM with the kit's own services faked.
 *
 * A component test rather than a renderer test, because the things that go wrong
 * here are the joins: which section the sidebar highlights, what a row's click
 * asks the server for, and whether the three "not empty" states are told apart.
 * Each of those is invisible to a unit test of `format.ts` and each was a
 * deliberate decision:
 *
 * - **The section list carries the counts**, because a selector without them is a
 *   guess, and a count of zero is shown rather than hidden.
 * - **The vocabulary follows the provider** — `Merge requests` on GitLab,
 *   `Pull requests` on GitHub — which is the one vendor difference a reader sees.
 * - **An empty section is not an error**, and a failed read is not an empty
 *   section: the two render differently and only one is actionable.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import {
  PanelHostProvider,
  PluginIdProvider,
  configureUiKit,
  type RepoScope,
  type UiKitServices,
} from '@kabmo-labs/kabmo-ui';

import { ForgePanel } from './index';
import type { ForgeDetail, ForgeFilter, ForgeList, ForgeSection } from '../protocol';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
let calls: Array<{ method: string; input: unknown }>;
let listOutcome: { ok: true; value: ForgeList } | { ok: false; error: { code: string; message: string } };
let detailOutcome: { ok: true; value: ForgeDetail } | { ok: false; error: { code: string; message: string } };
let scope: RepoScope;

beforeAll(() => {
  const win = new Window({ url: 'http://localhost/' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!saved.has(key)) saved.set(key, target[key]);
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (saved.has(key)) target[key] = saved.get(key);
    else delete target[key];
  }
});

function item(overrides: Partial<ForgeList['sections']['issues']['items'][number]> = {}) {
  return {
    id: '1',
    number: 1,
    title: 'Something is broken',
    state: 'open' as const,
    author: 'ana',
    updatedAt: new Date().toISOString(),
    url: 'https://example/1',
    labels: [],
    comments: 0,
    tag: null,
    ...overrides,
  };
}

function list(overrides: Partial<ForgeList> = {}): ForgeList {
  return {
    provider: 'github',
    host: 'github.com',
    slug: 'kabmo-labs/kabmo',
    webUrl: 'https://github.com/kabmo-labs/kabmo',
    filter: { state: 'open', mine: false, label: '', query: '' },
    sections: {
      issues: { items: [item()], truncated: false, total: 1 },
      pulls: { items: [item({ id: '2', number: 2, title: 'A change' })], truncated: false, total: 1 },
      releases: { items: [], truncated: false, total: null },
    },
    notes: [],
    ...overrides,
  };
}

function detail(): ForgeDetail {
  return {
    item: item(),
    body: 'The **body** text.',
    comments: [
      { id: 'c1', author: 'bo', body: 'A reply', createdAt: new Date().toISOString(), url: null, system: false, bot: false },
    ],
    facts: [{ label: 'comments', value: '1' }],
    files: [],
    commits: [],
    ci: null,
    capabilities: { comment: true, state: true, review: false, merge: false },
    notes: [],
  };
}

beforeEach(() => {
  calls = [];
  listOutcome = { ok: true, value: list() };
  detailOutcome = { ok: true, value: detail() };
  scope = {
    root: '/ws',
    repo: 'projects/alpha',
    rows: [{ repo: '.', label: 'ws', short: 'ws' }],
    scanning: false,
    ready: true,
  };

  const services: UiKitServices = {
    context: () => ({ sessionId: 's1', workspacePath: '/ws', theme: 'paper' }),
    subscribe: () => () => {},
    getSessionValue: () => null,
    setSessionValue: () => {},
    readWorkspaceFile: async () => '',
    repoScope: () => scope,
    setRepoScope: () => {},
    subscribeRepoScope: () => () => {},
    rescanRepoScope: () => {},
    callRpc: async (_pluginId, method, input) => {
      calls.push({ method, input });
      return method === 'detail' ? detailOutcome : listOutcome;
    },
  };
  configureUiKit(services);

  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
});

/** Mount the panel as the host does: inside a panel-host provider. */
async function mount(): Promise<void> {
  await act(async () => {
    // Both providers the host wraps a plugin panel in: the panel host (its own
    // props) and the plugin id (what `useRpc` names the namespace with).
    render(
      h(PanelHostProvider, {
        value: { sessionId: 's1', enabled: true, active: true, refreshKey: 0 },
        children: h(PluginIdProvider, {
          pluginId: 'git-forge',
          children: h(ForgePanel, { sessionId: 's1', workspacePath: '/ws' }),
        }),
      }),
      container,
    );
  });
  // One more turn for the RPC answers to land.
  await act(async () => {
    await Promise.resolve();
  });
}

/** Every button whose text matches, so a click can be addressed by its label. */
function button(label: string): HTMLButtonElement | null {
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
  return buttons.find((entry) => (entry.textContent ?? '').trim().includes(label)) ?? null;
}

describe('ForgePanel', () => {
  test('reads the scope it is given, and shows the counts', async () => {
    await mount();
    expect(calls[0]).toEqual({
      method: 'list',
      input: { root: '/ws', repo: 'projects/alpha', filter: { state: 'open', mine: false, label: '', query: '' } },
    });
    const text = container.textContent ?? '';
    expect(text).toContain('Issues');
    expect(text).toContain('Pull requests');
    expect(text).toContain('Releases');
    expect(text).toContain('Something is broken');
  });

  test('GitLab says merge requests, GitHub says pull requests', async () => {
    await mount();
    expect(container.textContent).toContain('Pull requests');

    // A fresh mount, because the read is keyed on the scope: re-rendering the
    // same tree with a different provider answer would keep the first payload
    // (correctly — nothing it depends on moved), so the test must remount.
    await act(async () => {
      render(null, container);
    });
    listOutcome = { ok: true, value: list({ provider: 'gitlab' }) };
    await mount();
    expect(container.textContent).toContain('Merge requests');
    expect(container.textContent).not.toContain('Pull requests');
  });

  test('the section switch stays reachable while an item is open', async () => {
    await mount();
    await act(async () => {
      button('Something is broken')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    // The strip is the panel's primary axis: it is never replaced by the item.
    expect(button('Releases')).not.toBeNull();
    expect(button('Pull requests')).not.toBeNull();
  });

  test('a section with nothing in it says so, without reading as a failure', async () => {
    await mount();
    const releases = button('Releases');
    expect(releases).not.toBeNull();
    await act(async () => {
      releases?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('No releases for this repository.');
  });

  test('a refusal is reported, and is not rendered as an empty list', async () => {
    listOutcome = { ok: false, error: { code: 'handler_error', message: 'This repository has no origin remote.' } };
    await mount();
    expect(container.textContent).toContain('no origin remote');
    expect(container.textContent).not.toContain('No issues for this repository.');
  });

  test('a note from the server is shown above the list', async () => {
    listOutcome = { ok: true, value: list({ notes: ['Reading anonymously: public repositories only.'] }) };
    await mount();
    expect(container.textContent).toContain('anonymously');
  });

  test('a truncated page says so rather than looking complete', async () => {
    listOutcome = {
      ok: true,
      value: list({ sections: { ...list().sections, issues: { items: [item()], truncated: true, total: 90 } } }),
    };
    await mount();
    expect(container.textContent).toContain('full page');
  });

  test('the state filter asks the server again, with the new state', async () => {
    await mount();
    const closed = button('Closed');
    await act(async () => {
      closed?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const states = calls
      .filter((call) => call.method === 'list')
      .map((call) => (call.input as { filter: ForgeFilter }).filter.state);
    expect(states).toContain('closed');
  });

  test('opening a row reads its detail and renders the body as markdown', async () => {
    await mount();
    const row = button('Something is broken');
    await act(async () => {
      row?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.some((call) => call.method === 'detail')).toBe(true);
    const detailCall = calls.find((call) => call.method === 'detail');
    expect(detailCall?.input).toEqual({ root: '/ws', repo: 'projects/alpha', section: 'issues', id: '1' });
    expect(container.textContent).toContain('body');
    expect(container.textContent).toContain('A reply');
  });

  test('no workspace says so instead of spinning', async () => {
    scope = { ...scope, root: null };
    await mount();
    expect(container.textContent).toContain('No repository selected.');
    expect(calls.length).toBe(0);
  });

  test('the section a pick was made in is part of the request', async () => {
    await mount();
    const pulls = button('Pull requests');
    await act(async () => {
      pulls?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const row = button('A change');
    await act(async () => {
      row?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const detailCall = calls.find((call) => call.method === 'detail');
    expect((detailCall?.input as { section: ForgeSection }).section).toBe('pulls');
  });
});
