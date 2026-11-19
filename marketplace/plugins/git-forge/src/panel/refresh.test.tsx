/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Forge panel's two re-reads: the header's Refresh and the one a write owes.
 *
 * Both are "fetch again" controls, and both were wrong in the same way — each
 * moved only PART of what the panel draws:
 *
 * - **Refresh** called the list read alone. A reader who pressed it while an
 *   issue or merge request was open got a fresh list and an item whose state,
 *   CI verdict, files and conversation stayed at their mount values — the exact
 *   page they were looking at was the one the control did not touch.
 * - **A write** re-read the detail alone, and the item's state badge is drawn
 *   from the LIST's row, so a closed issue still read `open` behind it.
 *
 * Kept in its own file because `index.test.tsx` is already past the repo's
 * per-file ceiling; the harness is repeated there and in `write.test.tsx`.
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
import type { ForgeDetail, ForgeList } from '../protocol';
import { detail, item, list } from './test-fixtures';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
let calls: Array<{ method: string; input: unknown }>;
let listOutcome: { ok: true; value: ForgeList } | { ok: false; error: { code: string; message: string } };
let detailOutcome: { ok: true; value: ForgeDetail } | { ok: false; error: { code: string; message: string } };
let writeOutcome: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
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

beforeEach(() => {
  calls = [];
  listOutcome = { ok: true, value: list() };
  detailOutcome = { ok: true, value: detail() };
  writeOutcome = { ok: true, value: { item: item(), message: 'Comment posted.' } };
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
      if (method === 'detail') return detailOutcome;
      if (method === 'write') return writeOutcome;
      if (method === 'credential') return { ok: true, value: { source: 'cli', present: true, writeScope: null } };
      return listOutcome;
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

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Mount the panel, then open the first issue so the detail page is on screen. */
async function mount(): Promise<void> {
  await act(async () => {
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
  await settle();
  const row = [...container.querySelectorAll('button')].find((entry) =>
    (entry.getAttribute('aria-label') ?? '').includes('Something is broken'),
  );
  await act(async () => {
    row?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

function button(label: string): HTMLButtonElement | null {
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
  return (
    buttons.find((entry) => (entry.getAttribute('aria-label') ?? '').trim() === label) ??
    buttons.find((entry) => (entry.textContent ?? '').trim() === label) ??
    null
  );
}

const count = (method: string): number => calls.filter((call) => call.method === method).length;

describe('ForgePanel refresh', () => {
  test('the header refresh re-reads the open item, not only the list', async () => {
    await mount();
    const listsBefore = count('list');
    const detailsBefore = count('detail');

    const refresh = button('Re-read from the host');
    expect(refresh).not.toBeNull();
    await act(async () => {
      refresh?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    // The open merge request is the page on screen: a refresh that moved only
    // the list would leave its state, checks and conversation stale.
    expect(count('detail')).toBe(detailsBefore + 1);
    expect(count('list')).toBe(listsBefore + 1);
  });

  test('a write re-reads the list as well as the item, so its state badge moves', async () => {
    await mount();
    const listsBefore = count('list');
    const detailsBefore = count('detail');

    const box = container.querySelector('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
    await act(async () => {
      box.value = 'Looks good';
      box.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    const post = button('Post a comment on #1');
    expect(post).not.toBeNull();
    await act(async () => {
      post?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    // The badge in the item's header is drawn from the LIST's row, so a write
    // that re-read only the detail leaves a closed issue reading `open`.
    expect(count('detail')).toBe(detailsBefore + 1);
    expect(count('list')).toBe(listsBefore + 1);
  });
});
