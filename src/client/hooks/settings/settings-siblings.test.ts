/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/** The settings screens' sibling state machines: the master/detail
 * pane rule, the workspace-root resolution, and the settings writer's
 * diff-persist. Split verbatim from `crud-list.test.ts` so both files stay
 * under the repo's 350-line ceiling; the CRUD list keeps its own file. */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { GLOBAL_SCOPE_ID, useWorkspaceRoots, type WorkspaceRoots } from '@/client/hooks/settings/workspace-roots';
import { useKabmoSettingsWriter } from '@/client/hooks/settings/use-kabmo-setting';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { primeKabmoSettings, readKabmoSetting } from '@/shared/lib/settings/client';
type Settings = { theme?: string; editorFont?: string };
import { diffSettings } from '@/shared/lib/settings/diff';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};
/** The runner's own fetch, put back on teardown — deleting it strips the global every later file needs. */
/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

let container: HTMLElement;
let masterDetail: { pane: string; openDetail: () => void; back: () => void } | null = null;
let workspaceRoots: WorkspaceRoots | null = null;
let writeSettings: ((patch: Record<string, unknown>) => void) | null = null;

const requests: Array<{ url: string; method: string; body: string }> = [];
let respond: (url: string, init?: RequestInit) => Response;

const json = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function MasterDetailProbe() {
  masterDetail = useSettingsMasterDetail();
  return h('div', null, masterDetail.pane);
}

function WorkspaceRootsProbe() {
  workspaceRoots = useWorkspaceRoots();
  return h('div', null, String(workspaceRoots.options.length));
}

function WriterProbe() {
  writeSettings = useKabmoSettingsWriter();
  return null;
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
  respond = (_url, init) => {
    if ((init?.method ?? 'GET') === 'GET') return json({ things: [{ id: 'a' }, { id: 'b' }] });
    return json({});
  };
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  masterDetail = null;
  workspaceRoots = null;
  writeSettings = null;
  requests.length = 0;
});

describe('useSettingsMasterDetail', () => {
  test('starts on the list pane and only an explicit choice opens the detail', async () => {
    await mount(h(MasterDetailProbe, {}));
    expect(masterDetail?.pane).toBe('list');
    await flush(() => masterDetail?.openDetail());
    expect(masterDetail?.pane).toBe('detail');
    await flush(() => masterDetail?.back());
    expect(masterDetail?.pane).toBe('list');
  });
});

describe('useWorkspaceRoots', () => {
  test('resolves a root by option id OR value and scopes the user option', async () => {
    respond = () => json({
      projects: [
        { id: 'p1', name: 'Alpha', path: '/work/alpha' },
        { id: 'p2', name: 'NoPath' },
        { id: 'p3', name: 'EmptyPath', path: '' },
      ],
    });
    await mount(h(WorkspaceRootsProbe, {}));

    expect(workspaceRoots?.options.map((option) => option.id)).toEqual(['p1', GLOBAL_SCOPE_ID]);
    expect(workspaceRoots?.options[0]?.value).toBe('/work/alpha');
    // Both the option id and the dropdown's value resolve to the same root.
    expect(workspaceRoots?.rootFor('p1')).toBe('/work/alpha');
    expect(workspaceRoots?.rootFor('/work/alpha')).toBe('/work/alpha');
    expect(workspaceRoots?.rootFor(GLOBAL_SCOPE_ID)).toBeNull();
    expect(workspaceRoots?.rootFor('unknown')).toBeNull();

    expect(workspaceRoots?.queryFor('/work/alpha')).toBe('?root=%2Fwork%2Falpha');
    expect(workspaceRoots?.queryFor(GLOBAL_SCOPE_ID)).toBe('?scope=user');
    expect(workspaceRoots?.scopeBodyFor('/work/alpha')).toEqual({ root: '/work/alpha' });
    expect(workspaceRoots?.scopeBodyFor('unknown')).toEqual({ scope: 'user' });
    expect(workspaceRoots?.isWorkspace('/work/alpha')).toBe(true);
    expect(workspaceRoots?.isWorkspace(GLOBAL_SCOPE_ID)).toBe(false);
  });
});

describe('useKabmoSettingsWriter', () => {
  test('persists only the keys a diff reports as moved', async () => {
    primeKabmoSettings({ omp_chamber_settings: { theme: 'dark', editorFont: 'Menlo' } });
    await mount(h(WriterProbe, {}));
    const prev: Settings = { theme: 'dark', editorFont: 'Menlo' };
    const next: Settings = { theme: 'light', editorFont: 'Menlo' };

    await flush(() => writeSettings?.(diffSettings(prev, next, { theme: 'light' })));

    const posts = requests.filter((request) => request.method === 'POST');
    expect(posts.map((post) => post.url)).toEqual(['/api/settings']);
    if (posts.length !== 1) throw new Error('expected one POST in the request log');
    const body = posts[0]?.body;
    if (typeof body !== 'string') throw new Error('expected a JSON body in the POST');
    expect(JSON.parse(body)).toMatchObject({ kabmo_settings: { theme: 'light' } });
    expect(String(readKabmoSetting('theme'))).toBe('light');
  });
});
