/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The assembled panel, mounted in a real DOM with the kit's own services faked.
 *
 * A component test rather than a formatter test, because what goes wrong here is
 * the JOINTS: which repository the read names, whether a failed read is drawn as
 * an empty list, whether clicking a row asks the server for that run, and whether
 * a log refusal is a sentence rather than an empty pane. Each of those is
 * invisible to a unit test of `format.ts`.
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

import type { RunDetail, RunPage } from '../protocol';
import { ActionsPanel } from './index';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Text', 'Element', 'SVGElement'] as const;
const saved = new Map<string, unknown>();

let container: HTMLElement;
let calls: Array<{ method: string; input: unknown }>;
let listOutcome: { ok: true; value: RunPage } | { ok: false; error: { code: string; message: string } };
let runOutcome: { ok: true; value: RunDetail } | { ok: false; error: { code: string; message: string } };
let logOutcome: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } };
let scope: RepoScope;

const RUN_SUCCESS = {
  id: 1,
  name: 'Gates',
  title: 'fix(terminal): keep the shell attached',
  branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  state: 'success' as const,
  number: 9,
  attempt: 1,
  actor: 'ana',
  createdAt: '2026-11-20T10:00:00Z',
  startedAt: '2026-11-20T10:00:00Z',
  updatedAt: '2026-11-20T10:02:00Z',
  url: 'https://github.com/o/r/actions/runs/1',
};

const RUN_FAILURE = {
  ...RUN_SUCCESS,
  id: 2,
  name: 'Release',
  title: 'feat(chat): draggable column',
  conclusion: 'failure',
  state: 'failure' as const,
  number: 185,
  updatedAt: '2026-11-20T12:19:35Z',
  url: 'https://github.com/o/r/actions/runs/2',
};

function page(overrides: Partial<RunPage> = {}): RunPage {
  return {
    slug: 'kabmo-labs/kabmo',
    host: 'github.com',
    authenticated: true,
    branch: '',
    status: '',
    runs: [RUN_FAILURE, RUN_SUCCESS],
    total: 2,
    truncated: false,
    notes: [],
    ...overrides,
  };
}

function detail(): RunDetail {
  return {
    run: RUN_FAILURE,
    jobs: [
      {
        id: 11,
        name: 'Gates / Checks',
        status: 'completed',
        conclusion: 'failure',
        state: 'failure',
        startedAt: '2026-11-20T12:12:32Z',
        completedAt: '2026-11-20T12:12:54Z',
        runner: 'GitHub Actions 1000003378',
        labels: ['ubuntu-latest'],
        url: null,
        steps: [
          { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success', state: 'success', startedAt: null, completedAt: null },
          { number: 2, name: 'Test', status: 'completed', conclusion: 'failure', state: 'failure', startedAt: null, completedAt: null },
        ],
      },
      {
        id: 12,
        name: 'E2E / Chromium',
        status: 'completed',
        conclusion: 'success',
        state: 'success',
        startedAt: '2026-11-20T12:12:32Z',
        completedAt: '2026-11-20T12:16:00Z',
        runner: 'GitHub Actions 1000003380',
        labels: ['ubuntu-latest'],
        url: null,
        steps: [],
      },
    ],
    progress: { done: 2, total: 2, failing: 1, running: null, runningStep: null },
    notes: [],
  };
}

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
  listOutcome = { ok: true, value: page() };
  runOutcome = { ok: true, value: detail() };
  logOutcome = { ok: false, error: { code: 'handler_error', message: 'Job logs need a token: GitHub answers 403 to an anonymous read.' } };
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
      if (method === 'run') return runOutcome;
      if (method === 'log') return logOutcome;
      if (method === 'watch' || method === 'unwatch') return { ok: true, value: {} };
      if (method === 'act') return { ok: true, value: { message: 'Cancellation requested.' } };
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

async function mount(): Promise<void> {
  await act(async () => {
    render(
      h(PanelHostProvider, {
        value: { sessionId: 's1', enabled: true, active: true, refreshKey: 0 },
        children: h(PluginIdProvider, {
          pluginId: 'github-actions',
          children: h(ActionsPanel, {}),
        }),
      }),
      container,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function click(element: Element | null | undefined): void {
  element?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function row(id: number): Element | null {
  return container.querySelector(`[data-action-row="${id}"]`);
}

describe('ActionsPanel', () => {
  test('reads the shared scope and draws one row per run', async () => {
    await mount();
    expect(calls[0]).toEqual({
      method: 'list',
      input: { root: '/ws', repo: 'projects/alpha', filter: { branch: '', status: '' } },
    });
    expect(row(2)).not.toBeNull();
    expect(row(1)).not.toBeNull();
    const text = container.textContent ?? '';
    expect(text).toContain('Release');
    expect(text).toContain('#185');
    expect(text).toContain('main');
  });

  test('a failed read is a sentence, not an empty list', async () => {
    listOutcome = { ok: false, error: { code: 'handler_error', message: 'This checkout has no `origin` remote.' } };
    await mount();
    expect(container.textContent).toContain('no `origin` remote');
    expect(row(2)).toBeNull();
  });

  test('opening a run asks for that run and shows its progress', async () => {
    await mount();
    await act(async () => {
      click(row(2));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const runCall = calls.find((call) => call.method === 'run');
    expect(runCall).toBeDefined();
    const input = runCall?.input;
    const askedId = input && typeof input === 'object' && 'id' in input ? input.id : null;
    expect(askedId).toBe(2);
    const text = container.textContent ?? '';
    expect(text).toContain('2/2 jobs');
    expect(text).toContain('1 failing');
    expect(text).toContain('Gates / Checks');
  });

  test('a log refusal names the token instead of drawing an empty pane', async () => {
    await mount();
    await act(async () => {
      click(row(2));
    });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      click(container.querySelector('[data-job-log="11"]'));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls.some((call) => call.method === 'log')).toBe(true);
    expect(container.textContent).toContain('Job logs need a token');
  });

  test('a run with no matching filter says what would find one', async () => {
    listOutcome = { ok: true, value: page({ runs: [], total: 0 }) };
    await mount();
    expect(container.textContent).toContain('Clear the branch or state');
  });

  test('the verbs are absent without a token, and the reason is stated', async () => {
    listOutcome = { ok: true, value: page({ authenticated: false }) };
    await mount();
    await act(async () => {
      click(row(2));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const buttons = [...container.querySelectorAll('button')].map((button) => button.textContent ?? '');
    expect(buttons.some((label) => label.includes('Cancel'))).toBe(false);
    expect(container.textContent).toContain('need a token');
  });
});
