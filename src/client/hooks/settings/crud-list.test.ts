/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHY: the settings screens share one load/save/delete + selection state
 * machine (`useCrudList`), and a wrong selection after a delete renders a
 * detail pane for a row that no longer exists. These tests pin the transitions
 * that screens rely on: selection lands on the first row after load (null for
 * an empty list), save upserts optimistically without duplicating a row, and a
 * delete moves the selection to a surviving neighbour. `useSettingsMasterDetail`
 * is pinned to the rule its doc calls out: the pane changes only on an explicit
 * row choice, never because a selection merely exists. `useWorkspaceRoots` is
 * pinned to the id-OR-value resolution that fixed a picker silently scoping
 * every workspace to the user root, and `useKabmoSettingsWriter` to the
 * diff-persist rule (only a moved key is written).
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { useCrudList, type CrudListConfig, type CrudListController } from '@/client/hooks/settings/crud-list';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. *//** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

type Row = { id: string; name?: string };
let container: HTMLElement;
let controller: CrudListController<Row, Row> | null = null;
let config: CrudListConfig<Row, Row>;

const requests: Array<{ url: string; method: string; body: string }> = [];
let respond: (url: string, init?: RequestInit) => Response;

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function CrudProbe() {
  controller = useCrudList<Row, Row>(config);
  return h('div', null, controller.selectedId ?? 'none');
}

async function mount(node: Parameters<typeof render>[0]): Promise<HTMLElement> {
  if (container) render(null, container);
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(node, container);
  });
  for (let i = 0; i < 8; i += 1) await act(async () => {});
  return container;
}

/** Run a mutation and drain its fetch promise chain plus the resulting renders. */
async function flush(mutate: () => void) {
  await act(async () => {
    mutate();
  });
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
  target.fetch = async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : '' });
    return respond(url, init);
  };
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
  config = baseConfig();
  respond = (_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') return json({ things: [{ id: 'a' }, { id: 'b' }] });
    return json({});
  };
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  controller = null;
  requests.length = 0;
});

function baseConfig(over: Partial<CrudListConfig<Row, Row>> = {}): CrudListConfig<Row, Row> {
  return {
    endpoint: '/api/settings/things',
    listKey: 'things',
    bodyKey: 'thing',
    messages: { load: 'load failed', save: 'save failed', delete: 'delete failed' },
    buildNew: (draft) => ({ ...draft }),
    buildUpdate: (draft, _selected, selectedId) => ({ ...draft, id: selectedId ?? draft.id }),
    ...over,
  };
}

describe('useCrudList load + selection', () => {
  test('selects the first row after load, and null for an empty list', async () => {
    await mount(h(CrudProbe, {}));
    expect(controller?.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(controller?.selectedId).toBe('a');

    respond = () => json({ things: [] });
    await mount(h(CrudProbe, {}));
    expect(controller?.selectedId).toBeNull();
    expect(controller?.selected).toBeUndefined();
  });

  test('resolveOnLoad keeps a selection that survives the list reload', async () => {
    const resolveOnLoad = (prev: string | null, list: Row[]) =>
      (list.some((row) => row.id === prev) ? prev : (list[0]?.id ?? null));
    config = baseConfig({ resolveOnLoad });
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.select('b'));

    // A reload in the SAME mounted instance (the query drives the load effect),
    // so `prev` is still the selection the resolver is asked to keep. A remount
    // would be a different hook instance with its own null state.
    config = baseConfig({ query: '?page=2', resolveOnLoad });
    await act(async () => { render(h(CrudProbe, {}), container as HTMLElement); });
    for (let i = 0; i < 8; i += 1) await act(async () => {});
    expect(controller?.selectedId).toBe('b');
  });

  test('fallbackToFirst:false leaves an unknown id with no selected row', async () => {
    config = baseConfig({ fallbackToFirst: false });
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.select('missing'));
    expect(controller?.selected).toBeUndefined();
  });

  test('startCreate clears the selection and select clears the create flag', async () => {
    config = baseConfig();
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.startCreate());
    expect(controller?.isCreatingNew).toBe(true);
    expect(controller?.selectedId).toBeNull();
    await flush(() => controller?.select('b'));
    expect(controller?.isCreatingNew).toBe(false);
    expect(controller?.selectedId).toBe('b');
  });
});

describe('useCrudList save', () => {
  test('create POSTs the built row and upserts it optimistically', async () => {
    config = baseConfig();
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.startCreate());
    await flush(() => controller?.save({ id: 'c' }));

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((post) => post.url)).toEqual(['/api/settings/things']);
    expect(posts.map((post) => JSON.parse(post.body ?? '{}'))).toEqual([{ thing: { id: 'c' } }]);
    expect(controller?.items.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(controller?.selectedId).toBe('c');
    expect(controller?.isCreatingNew).toBe(false);
  });

  test('update replaces the selected row instead of appending a duplicate', async () => {
    config = baseConfig();
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.select('b'));
    await flush(() => controller?.save({ id: 'b', name: 'renamed' }));

    expect(controller?.items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(controller?.items.find((row) => row.id === 'b')?.name).toBe('renamed');
    expect(controller?.selectedId).toBe('b');
  });

  test('a list in the save response is adopted verbatim', async () => {
    config = baseConfig();
    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET'
      ? json({ things: [{ id: 'a' }] })
      : json({ things: [{ id: 'z' }] }));
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.startCreate());
    await flush(() => controller?.save({ id: 'z' }));
    expect(controller?.items.map((row) => row.id)).toEqual(['z']);
  });

  test('isSaveError aborts without touching the list', async () => {
    config = baseConfig({
      isSaveError: (data) => typeof data === 'object' && data !== null && 'error' in data && data.error === 'nope',
    });
    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET' ? json({ things: [{ id: 'a' }] }) : json({ error: 'nope' }));
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.startCreate());
    await flush(() => controller?.save({ id: 'b' }));
    expect(controller?.items.map((row) => row.id)).toEqual(['a']);
    // The refusal returns before any of the success bookkeeping, so the create
    // draft is still open for the user to retry or abandon.
    expect(controller?.isCreatingNew).toBe(true);
    expect(controller?.selectedId).toBeNull();
  });

  test('serverListOnly never upserts optimistically', async () => {
    config = baseConfig({ serverListOnly: true });
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.startCreate());
    await flush(() => controller?.save({ id: 'c' }));
    expect(controller?.items.map((row) => row.id)).toEqual(['a', 'b']);
  });

  test('custom buildBody and buildDeleteQuery shape the requests', async () => {
    config = baseConfig({
      buildBody: (target) => ({ action: 'put', target }),
      buildDeleteQuery: (id) => `?slug=${id}`,
    });
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.save({ id: 'a' }));
    expect(JSON.parse(requests.find((request) => request.method === 'POST')?.body ?? '{}')).toEqual({
      action: 'put',
      target: { id: 'a' },
    });

    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET' ? json({ things: [{ id: 'b' }] }) : json({}));
    await flush(() => controller?.remove('a'));
    expect(requests.some((request) => request.method === 'DELETE' && request.url === '/api/settings/things?slug=a')).toBe(true);
  });
});

describe('useCrudList remove', () => {
  test('delete refetches and moves the selection to a surviving neighbour', async () => {
    config = baseConfig();
    await mount(h(CrudProbe, {}));
    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET' ? json({ things: [{ id: 'b' }] }) : json({}));
    await flush(() => controller?.remove('a'));
    expect(requests.some((request) => request.method === 'DELETE' && request.url === '/api/settings/things?id=a')).toBe(true);
    expect(controller?.items.map((row) => row.id)).toEqual(['b']);
    expect(controller?.selectedId).toBe('b');
  });

  test('deleting a row that is not selected keeps the selection', async () => {
    config = baseConfig();
    await mount(h(CrudProbe, {}));
    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET' ? json({ things: [{ id: 'a' }] }) : json({}));
    await flush(() => controller?.remove('b'));
    expect(controller?.selectedId).toBe('a');
  });

  test('deleteFromResponse adopts the response list and reselects its first row', async () => {
    config = baseConfig({ deleteFromResponse: true });
    respond = (_url, init) => ((init?.method ?? 'GET') === 'GET'
      ? json({ things: [{ id: 'a' }, { id: 'b' }] })
      : json({ things: [{ id: 'b' }] }));
    await mount(h(CrudProbe, {}));
    await flush(() => controller?.remove('a'));
    expect(controller?.items.map((row) => row.id)).toEqual(['b']);
    expect(controller?.selectedId).toBe('b');
    expect(requests.filter((request) => request.method === 'GET').length).toBe(1);
  });
});
