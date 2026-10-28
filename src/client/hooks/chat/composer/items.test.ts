/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer pick model: what `@`/`/` offers, and how `useComposerItems`
 * loads it.
 *
 * The failures pinned here are all about a menu that lies:
 *
 * - A workspace file must never be offered as a bare `@name` token. A root-level
 *   file called `sonic` would otherwise insert `@sonic` and collide with the
 *   agent of that name, so files travel in the `file:` namespace (and quoted
 *   when the path contains whitespace, which would otherwise end the token).
 * - The Kabmo's own commands lead, and a skill a command already covers is
 *   skipped, so the same skill is never listed twice under two tokens.
 * - A hook must discard a response that lands after its `kind` changed: the
 *   late items would otherwise repopulate a menu the user has already left.
 * - A `commandPaletteAction` a plugin registered must appear in the `/` popup
 *   beside Kabmo's own commands — and only there: a closed menu or an `@`
 *   mention must not gain a row the user cannot act on.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { ComposerPickItem, ComposerPickKind } from '@/shared/types';
import { useComposerItems } from '@/client/hooks/chat/composer/items';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import {
  invalidateComposerCache,
  loadComposerItems,
  toAgentPickItems,
  toFilePickItems,
} from '@/shared/lib/chat/composer/client';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. *//** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

interface Answer { ok?: boolean; status?: number; body?: unknown }
type Route = Answer | 'pending';

const requested: string[] = [];
let pendingAnswers: Array<(answer: Answer) => void> = [];
let answer: (url: string) => Route = () => ({ ok: true, status: 200, body: {} });

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = (async (input: unknown) => {
    const url = String(input);
    requested.push(url);
    const route = answer(url);
    const value = route === 'pending'
      ? await new Promise<Answer>((resolve) => pendingAnswers.push(resolve))
      : route;
    const ok = value.ok ?? true;
    return { ok, status: value.status ?? (ok ? 200 : 500), json: async () => value.body };
  }) as unknown as typeof fetch;
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
  if (nativeFetch) target.fetch = nativeFetch;
  else delete target.fetch;
});

beforeEach(() => {
  invalidateComposerCache();
  resetListSlots();
  requested.length = 0;
  pendingAnswers = [];
  answer = () => ({ ok: true, status: 200, body: {} });
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

let container: HTMLElement;
/** The hook's returned state shape; the module keeps its own interface local. */
interface ItemsState {
  items: ComposerPickItem[];
  loading: boolean;
  error: string | null;
}
let state: ItemsState;

function Probe({ kind, root }: { kind: ComposerPickKind | null; root?: string | null }) {
  state = useComposerItems(kind, root);
  return null;
}

/** Mounts, then drains the fetch chain and the renders it queues. */
async function settle(renders = 4) {
  for (let i = 0; i < renders; i += 1) await act(async () => { await Promise.resolve(); });
}

async function mount(kind: ComposerPickKind | null, root?: string | null) {
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => { render(h(Probe, { kind, root }), container); });
}

describe('useComposerItems', () => {
  test('a null kind is a closed menu: no fetch, no loading, no error', async () => {
    await mount(null);
    await settle();
    expect(state).toEqual({ items: [], loading: false, error: null });
    expect(requested).toEqual([]);
  });

  test('loading is reported before the items land, then cleared', async () => {
    answer = () => 'pending';
    await mount('mention');
    await settle(2);
    expect(state.loading).toBe(true);
    expect(state.items).toEqual([]);

    // `mention` issues two requests (agents, files); both must land.
    pendingAnswers.splice(0).forEach((resolve) => resolve({ ok: true, status: 200, body: { agents: [], files: [] } }));
    await settle();
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  test('items are surfaced for the requested kind', async () => {
    answer = (url) => url.includes('/api/fs/list')
      ? { body: { files: [{ name: 'a.ts', path: 'src/a.ts' }] } }
      : { body: { agents: [{ id: 'x', name: 'sonic', description: 'fast', scope: 'user', mode: 'primary', systemPrompt: '' }] } };

    await mount('mention', '/repo');
    await settle(6);
    expect(state.items.map((item) => item.token)).toEqual(['@sonic', '@file:src/a.ts']);
    expect(state.error).toBeNull();
  });

  test('a failed load becomes the error message, with no stale items left behind', async () => {
    answer = () => ({ ok: false, status: 500, body: null });
    await mount('command');
    await settle(4);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.error).toBe('GET /api/settings/commands failed: 500');
  });

  test('a response that lands after the menu closed is discarded', async () => {
    answer = () => 'pending';
    await mount('mention');
    await settle(2);
    expect(state.loading).toBe(true);

    // The user typed another character and the trigger went away.
    await act(async () => { render(h(Probe, { kind: null }), container); });
    pendingAnswers.forEach((resolve) => resolve({ ok: true, status: 200, body: { agents: [{ name: 'late' }], files: [] } }));
    await settle();
    expect(state).toEqual({ items: [], loading: false, error: null });
  });
});

describe('plugin commands in the popup', () => {
  const registration = {
    id: 'deploy',
    command: 'deploy',
    description: 'Deploy the workspace',
    hint: '[env]',
    run: () => {},
  };

  test('a registered command is appended beside Kabmo’s own commands', async () => {
    answer = () => ({ body: { commands: [], skills: [] } });
    await mount('command');
    await settle(6);
    const chamberIds = state.items.map((item) => item.id);
    expect(chamberIds).toContain('command-btw');

    registerListSlot('plug', 'commandPaletteAction', registration);
    await settle();

    expect(state.items.slice(0, chamberIds.length).map((item) => item.id)).toEqual(chamberIds);
    expect(state.items[chamberIds.length]).toEqual({
      id: 'plugin-command-plug-deploy',
      name: 'deploy',
      description: '[env] - Deploy the workspace',
      kind: 'command',
      source: 'command',
      token: '/deploy',
      inputHint: '[env]',
    });
  });

  test('a command with no hint carries its description verbatim', async () => {
    answer = () => ({ body: { commands: [], skills: [] } });
    registerListSlot('plug', 'commandPaletteAction', {
      id: 'status',
      command: 'status',
      description: 'Show the workspace status',
      run: () => {},
    });
    await mount('command');
    await settle(6);

    expect(state.items.find((item) => item.id === 'plugin-command-plug-status')).toEqual({
      id: 'plugin-command-plug-status',
      name: 'status',
      description: 'Show the workspace status',
      kind: 'command',
      source: 'command',
      token: '/status',
    });
  });

  test('two plugins may reuse the same registration id without colliding', async () => {
    answer = () => ({ body: { commands: [], skills: [] } });
    registerListSlot('alpha', 'commandPaletteAction', { ...registration, command: 'alpha-go' });
    registerListSlot('beta', 'commandPaletteAction', { ...registration, command: 'beta-go' });
    await mount('command');
    await settle(6);

    expect(state.items.filter((item) => item.id.startsWith('plugin-command-')).map((item) => item.id))
      .toEqual(['plugin-command-alpha-deploy', 'plugin-command-beta-deploy']);
  });

  test('a non-command kind is untouched by plugin rows', async () => {
    answer = () => ({ body: { agents: [], files: [] } });
    registerListSlot('plug', 'commandPaletteAction', registration);
    await mount('mention', '/repo');
    await settle(6);

    expect(state.items).toEqual([]);
  });

  test('a closed menu offers nothing, not even a plugin row', async () => {
    registerListSlot('plug', 'commandPaletteAction', registration);
    await mount(null);
    await settle();

    expect(state.items).toEqual([]);
  });
});

describe('pick item mapping', () => {
  test('an agent becomes a bare @name token', () => {
    const [item] = toAgentPickItems([
      { id: 'a1', name: 'sonic', description: 'fast', scope: 'user', mode: 'primary', systemPrompt: '' },
    ]);
    expect(item).toMatchObject({ id: 'agent-sonic', name: 'sonic', kind: 'agent', source: 'agent', token: '@sonic' });
  });

  test('a file is namespaced under file:, so a root-level name cannot shadow an agent', () => {
    const [item] = toFilePickItems([{ name: 'sonic', path: 'sonic' }]);
    expect(item.token).toBe('@file:sonic');
    expect(item.path).toBe('sonic');
  });

  test('a path with whitespace is quoted, so the token cannot end early', () => {
    const [item] = toFilePickItems([{ name: 'my notes.md', path: 'docs/my notes.md' }]);
    expect(item.token).toBe('@"file:docs/my notes.md"');
  });
});

describe('loadComposerItems', () => {
  test('mention merges agents first, then workspace files', async () => {
    answer = (url) => url.includes('/api/settings/agents')
      ? { body: { agents: [{ id: 'a', name: 'sonic', description: '', scope: 'user', mode: 'primary', systemPrompt: '' }] } }
      : { body: { files: [{ name: 'a.ts', path: 'src/a.ts' }] } };

    const items = await loadComposerItems('mention', '/repo');
    expect(items.map((item) => item.source)).toEqual(['agent', 'file']);
    expect(requested).toContain('/api/fs/list?root=%2Frepo');
  });

  test('a repeated load is served from the cache without another request', async () => {
    answer = () => ({ body: { agents: [] } });
    await loadComposerItems('mention');
    const afterFirst = requested.length;
    await loadComposerItems('mention');
    expect(requested.length).toBe(afterFirst);
  });

  test('invalidation is scoped by prefix, so one workspace does not drop another', async () => {
    answer = () => ({ body: { commands: [], skills: [] } });
    await loadComposerItems('command', '/one');
    await loadComposerItems('command', '/two');
    expect(requested.length).toBe(4);

    invalidateComposerCache('command::/one');
    await loadComposerItems('command', '/one');
    await loadComposerItems('command', '/two');
    // Only the invalidated root was fetched again.
    expect(requested.length).toBe(6);
  });

  test('a command entry is a /name token and a skill is prefixed', async () => {
    answer = (url) => url.includes('/commands')
      ? { body: { commands: [{ id: 'c', name: 'fix', description: 'fix it', scope: 'user', template: '/fix' }] } }
      : { body: { skills: [{ id: 's', name: 'review', description: 'review it', location: 'user' }] } };

    const items = await loadComposerItems('command');
    const byToken = new Map(items.map((item) => [item.token, item]));
    expect(byToken.get('/fix')?.kind).toBe('command');
    expect(byToken.get('/skill:review')?.kind).toBe('skill');
  });

  test('a skill a command already covers is not listed a second time', async () => {
    answer = (url) => url.includes('/commands')
      ? { body: { commands: [{ id: 'c', name: 'review', description: '', scope: 'user', template: '/review' }] } }
      : { body: { skills: [{ id: 's', name: 'review', description: '', location: 'user' }] } };

    const items: ComposerPickItem[] = await loadComposerItems('command');
    expect(items.filter((item) => item.name.toLowerCase().includes('review')).map((item) => item.token))
      .toEqual(['/review']);
  });
});
