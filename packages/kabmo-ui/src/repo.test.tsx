/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `useRepoScope` — the kit's view of the nested-repo scope the host's panels
 * share.
 *
 * The behaviours pinned here are the ones a plugin gets wrong when it reads the
 * session slot itself:
 *
 * - **The scope arrives late and changes from elsewhere.** The stored pick loads
 *   with the session and the four host panels write the same slot, so a
 *   component that captured the value once would show the previous repo forever.
 *   The hook must re-read on a service push.
 * - **A host that cannot answer is not an error.** An older host provides no
 *   `repoScope`, and the hook reports an empty scope so a panel draws "no
 *   workspace" instead of throwing.
 * - **A write goes through the SERVICE**, never through a private copy — that is
 *   the whole point of the shared slot, and a plugin that kept its own state
 *   would leave the host's picker behind.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { configureUiKit, useRepoScope, type RepoScope, type UiKitServices } from '@kabmo-labs/kabmo-ui';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event'] as const;
const nativeGlobals: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement;
let scope: RepoScope;
/** Every repo a test's component wrote, in order. */
let writes: string[];
/** Every rescan requested. */
let rescans: number;
/** The listeners the hook registered, so a test can push a change. */
let listeners: Array<() => void>;

const EMPTY: RepoScope = { root: null, repo: '.', rows: [], scanning: false, ready: false };

/** The services a host would inject, with only the repo seam under test. */
function services(): UiKitServices {
  return {
    context: () => ({ sessionId: 's1', workspacePath: '/ws', theme: 'paper' }),
    subscribe: () => () => {},
    getSessionValue: () => null,
    setSessionValue: () => {},
    readWorkspaceFile: async () => '',
    repoScope: () => scope,
    setRepoScope: (repo: string) => {
      writes.push(repo);
    },
    subscribeRepoScope: (listener: () => void) => {
      listeners.push(listener);
      return () => {
        listeners = listeners.filter((entry) => entry !== listener);
      };
    },
    rescanRepoScope: () => {
      rescans += 1;
    },
  };
}

beforeEach(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in nativeGlobals)) nativeGlobals[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  container = document.createElement('div') as unknown as HTMLElement;
  document.body.appendChild(container as never);
  scope = EMPTY;
  writes = [];
  rescans = 0;
  listeners = [];
  configureUiKit(services());
});

afterEach(() => {
  render(null, container);
  container.remove();
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (key in nativeGlobals) target[key] = nativeGlobals[key];
    else delete target[key];
  }
});

/** Render the hook and expose its value plus its two actions. */
function Probe() {
  const handle = useRepoScope();
  const text = [
    handle.root ?? 'null',
    handle.repo,
    handle.rows.map((row) => `${row.repo}=${row.label}/${row.short}`).join(','),
    handle.scanning ? 'scanning' : 'idle',
  ].join('|');
  return h(
    'div',
    { id: 'probe' },
    h('span', { id: 'value' }, text),
    h('button', { id: 'pick', onClick: () => handle.setRepo('projects/a/token') }, 'pick'),
    h('button', { id: 'refresh', onClick: () => handle.refresh() }, 'refresh'),
  );
}

const read = () => (container.querySelector('#value') as HTMLElement | null)?.textContent ?? '';

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('useRepoScope', () => {
  test('reports an empty scope against a host with no repo service', async () => {
    const base = services();
    delete base.repoScope;
    delete base.subscribeRepoScope;
    configureUiKit(base);

    await act(async () => render(h(Probe, {}), container));
    await settle();

    // "no workspace", never a throw: a plugin panel must still render.
    expect(read()).toBe('null|.||idle');
  });

  test('renders the host scope, rows and labels included', async () => {
    scope = {
      root: '/ws/Workspace',
      repo: '.',
      rows: [
        { repo: '.', label: 'Workspace', short: 'Workspace' },
        { repo: 'projects/a/token', label: 'projects/a/token', short: 'token' },
      ],
      scanning: false,
      ready: true,
    };

    await act(async () => render(h(Probe, {}), container));
    await settle();

    // The labels travel WITH the rows — the naming rule is the host's, and the
    // kit must not re-derive it.
    expect(read()).toBe('/ws/Workspace|.|.=Workspace/Workspace,projects/a/token=projects/a/token/token|idle');
  });

  test('a scope change pushed by the host re-renders the panel', async () => {
    scope = { root: '/ws', repo: '.', rows: [{ repo: '.', label: 'ws', short: 'ws' }], scanning: false, ready: true };
    await act(async () => render(h(Probe, {}), container));
    await settle();
    expect(read()).toStartWith('/ws|.');

    // The host's own picker moved the shared slot.
    scope = {
      root: '/ws',
      repo: 'projects/b',
      rows: [
        { repo: '.', label: 'ws', short: 'ws' },
        { repo: 'projects/b', label: 'projects/b', short: 'b' },
      ],
      scanning: false,
      ready: true,
    };
    await act(async () => {
      for (const listener of listeners) listener();
    });
    await settle();

    expect(read()).toContain('|projects/b|');
  });

  test('a write goes through the service, not a private copy', async () => {
    scope = { root: '/ws', repo: '.', rows: [{ repo: '.', label: 'ws', short: 'ws' }], scanning: false, ready: true };
    await act(async () => render(h(Probe, {}), container));
    await settle();

    await act(async () => {
      (container.querySelector('#pick') as HTMLButtonElement).click();
    });
    await settle();

    expect(writes).toEqual(['projects/a/token']);
  });

  test('refresh asks the service to rescan', async () => {
    scope = { root: '/ws', repo: '.', rows: [], scanning: false, ready: true };
    await act(async () => render(h(Probe, {}), container));
    await settle();

    await act(async () => {
      (container.querySelector('#refresh') as HTMLButtonElement).click();
    });
    await settle();

    expect(rescans).toBe(1);
  });

  test('unsubscribes on unmount', async () => {
    scope = { root: '/ws', repo: '.', rows: [], scanning: false, ready: true };
    await act(async () => render(h(Probe, {}), container));
    await settle();
    expect(listeners).toHaveLength(1);

    render(null, container);
    await settle();

    // A leaked listener would re-render a torn-down panel on every host write.
    expect(listeners).toHaveLength(0);
  });
});
