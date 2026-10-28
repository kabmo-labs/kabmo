/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write surface, mounted through the real panel.
 *
 * The rules here are the ones a reader would notice as a bug:
 *
 * - **The verbs come from the server's capability table**, never from the panel's
 *   own guess. A read-only credential therefore shows no verbs at all, and the
 *   panel does not have to know why.
 * - **Nothing is sent by a click on a verb.** The confirmation is what asks the
 *   host, and it names the consequence rather than "are you sure?".
 * - **A refusal is shown where the action was**, not in a toast that scrolls away.
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

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
let calls: Array<{ method: string; input: unknown }>;
let detailOutcome: { ok: true; value: ForgeDetail } | { ok: false; error: { code: string; message: string } };
let writeOutcome: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };

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

function item() {
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
  };
}

function list(): ForgeList {
  return {
    provider: 'github',
    host: 'github.com',
    slug: 'kabmo-labs/kabmo',
    webUrl: 'https://github.com/kabmo-labs/kabmo',
    filter: { state: 'open', mine: false, label: '', query: '' },
    sections: {
      issues: { items: [item()], truncated: false, total: 1 },
      pulls: { items: [], truncated: false, total: 0 },
      releases: { items: [], truncated: false, total: null },
    },
    notes: [],
  };
}

function detail(): ForgeDetail {
  return {
    item: item(),
    body: 'The body.',
    comments: [],
    facts: [],
    files: [],
    commits: [],
    ci: null,
    capabilities: { comment: true, state: true, review: false, merge: false },
    notes: [],
  };
}

let scope: RepoScope;

beforeEach(() => {
  calls = [];
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
    getSessionJson: () => undefined,
    setSessionJson: () => {},
    subscribeSessionJson: () => () => {},
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
      return { ok: true, value: list() };
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
  await act(async () => {
    await Promise.resolve();
  });
  const target = [...container.querySelectorAll('button')].find((entry) =>
    (entry.getAttribute('aria-label') ?? '').includes('Something is broken'),
  );
  await act(async () => {
    target?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** A button by its accessible name, exactly. */
function button(label: string): HTMLButtonElement | null {
  const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
  return (
    buttons.find((entry) => (entry.getAttribute('aria-label') ?? '').trim() === label) ??
    buttons.find((entry) => (entry.textContent ?? '').trim() === label) ??
    null
  );
}

async function click(label: string): Promise<void> {
  await act(async () => {
    button(label)?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('WriteBar', () => {
  test('the verbs come from the SERVER capability table', async () => {
    await mount();
    expect(button('Post a comment on #1')).not.toBeNull();
    expect(button('Close #1')).not.toBeNull();
    // The fixture's capabilities are comment + state only.
    expect(button('Approve #1')).toBeNull();
    expect(button('Merge #1')).toBeNull();
  });

  test('a read-only credential offers no verbs at all', async () => {
    detailOutcome = {
      ok: true,
      value: { ...detail(), capabilities: { comment: false, state: false, review: false, merge: false } },
    };
    await mount();
    for (const label of ['Post a comment on #1', 'Approve #1', 'Merge #1', 'Close #1']) {
      expect(button(label)).toBeNull();
    }
  });

  test('closing asks first, and the dialog names what happens', async () => {
    await mount();
    await click('Close #1');
    expect(container.textContent).toContain('stays readable and can be reopened');
    // Nothing has been sent yet: the confirmation is what asks the host.
    expect(calls.some((call) => call.method === 'write')).toBe(false);

    await click('Cancel');
    expect(container.textContent).not.toContain('stays readable and can be reopened');
  });

  test('a merge confirmation offers the three methods', async () => {
    detailOutcome = {
      ok: true,
      value: { ...detail(), capabilities: { comment: true, state: true, review: true, merge: true } },
    };
    await mount();
    await click('Merge #1');
    expect(container.querySelectorAll('input[name="forge-merge-method"]').length).toBe(3);
    expect(container.textContent).toContain('the branch history is not kept');
  });

  test('a comment posts the text that was typed, and reports the outcome', async () => {
    await mount();
    const box = container.querySelector('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
    await act(async () => {
      box.value = 'Looks good';
      box.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click('Post a comment on #1');

    const write = calls.find((call) => call.method === 'write');
    expect((write?.input as { write: unknown }).write).toEqual({ kind: 'comment', body: 'Looks good' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Comment posted.');
  });

  test('a refused write shows the server sentence where the action was', async () => {
    writeOutcome = { ok: false, error: { code: 'handler_error', message: 'GitLab has no "request changes" event.' } };
    await mount();
    const box = container.querySelector('textarea[aria-label="Comment"]') as HTMLTextAreaElement;
    await act(async () => {
      box.value = 'x';
      box.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await click('Post a comment on #1');
    expect(container.textContent).toContain('no "request changes" event');
  });
});
