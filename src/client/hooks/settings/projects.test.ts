/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Projects pane's state machine.
 *
 * The pane's failures used to be invisible: a save went out on every keystroke
 * and a refused one was logged and forgotten, so the form showed a value the
 * server never accepted until the next refresh silently reverted it. These
 * cases pin what a user observes instead — the row reverts, the reason is
 * reported, the server's own copy of the row wins, and a failed LIST is named
 * rather than drawn as "no projects".
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { useProjectSettings, type ProjectSettingsState } from '@/client/hooks/settings/projects';
import type { ProjectConfigItem } from '@/shared/types';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

let container: HTMLElement;
let state: ProjectSettingsState | null = null;
let errors: string[] = [];
let requests: Array<{ url: string; method: string; body: string }> = [];
let respond: (url: string, init?: RequestInit) => Response;

const realFetch = Bun.fetch;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function project(overrides: Partial<ProjectConfigItem> = {}): ProjectConfigItem {
  return {
    id: 'folder-1',
    folderId: 1,
    name: 'kabmo',
    path: '/work/kabmo',
    model: 'Not selected',
    accentColor: '',
    icon: 'default',
    isPinned: false,
    isExpanded: true,
    ...overrides,
  };
}

function Probe() {
  state = useProjectSettings((message) => errors.push(message));
  return null;
}

async function mount(): Promise<void> {
  if (container) render(null, container);
  container = document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, {}), container);
  });
  await flush();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    });
    return respond(url, init);
  }) as typeof fetch;
});

beforeEach(() => {
  requests = [];
  errors = [];
  state = null;
  respond = (url) => {
    if (url.startsWith('/api/models')) return json({ models: {}, modelList: [], defaultModel: null, thinkingLevels: {} });
    return json({ projects: [project()], accentColorOptions: [] });
  };
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
});

afterAll(() => {
  globalThis.fetch = realFetch;
  restoreDomGlobals();
});

describe('useProjectSettings', () => {
  test('loads the list and selects the first project', async () => {
    await mount();
    expect(state?.projects.map((row) => row.id)).toEqual(['folder-1']);
    expect(state?.selected?.name).toBe('kabmo');
    expect(state?.isLoading).toBe(false);
  });

  test('a refused save reverts the row and reports the reason', async () => {
    await mount();
    respond = () => json({ error: 'A workspace named "kabmo" already exists', code: 'duplicate_name' }, 409);

    const outcome: { accepted: boolean | null } = { accepted: null };
    await act(async () => {
      outcome.accepted = await state!.updateField(state!.selected!, 'name', 'Taken');
    });

    expect(outcome.accepted).toBe(false);
    expect(state?.selected?.name).toBe('kabmo');
    expect(errors).toEqual(['A workspace named "kabmo" already exists']);
  });

  test('an accepted save adopts the server row, not the typed one', async () => {
    await mount();
    respond = (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return json({ projects: [project()], accentColorOptions: [] });
      // The server trims and expands: the pane must show what was stored.
      return json({ success: true, changed: true, project: project({ name: 'Trimmed' }) });
    };

    await act(async () => {
      await state!.updateField(state!.selected!, 'name', '  Trimmed  ');
    });
    await flush();
    expect(state?.selected?.name).toBe('Trimmed');
  });

  test('a failed list read is named instead of rendering as an empty list', async () => {
    respond = () => json({ error: 'database is locked', projects: [] }, 500);
    await mount();
    expect(state?.loadError).toBe('database is locked');
    expect(state?.projects).toEqual([]);
  });

  test('adding a project creates with the given name and directory, then selects it', async () => {
    await mount();
    respond = (url, init) => {
      if (url === '/api/folders' && init?.method === 'POST') return json({ success: true, folder: { id: 9 } });
      if (url.startsWith('/api/settings/projects')) {
        return json({ projects: [project(), project({ id: 'folder-9', folderId: 9, name: 'new' })], accentColorOptions: [] });
      }
      return json({ modelList: [] });
    };

    await act(async () => {
      await state!.addProject({ name: 'new', path: '/work/new' });
    });
    await flush();

    const post = requests.find((request) => request.url === '/api/folders' && request.method === 'POST');
    expect(post?.body).toBe(JSON.stringify({ name: 'new', path: '/work/new' }));
    expect(state?.selectedId).toBe('folder-9');
    // The plus button used to create an UNBOUND folder with a generated name.
    expect(post?.body).not.toContain('Project ');
  });

  test('a refused creation reports the server sentence and rethrows to the dialog', async () => {
    await mount();
    respond = () => json({ error: 'A workspace with this name already exists', code: 'duplicate_name' }, 400);

    const failure: { error: Error | null } = { error: null };
    await act(async () => {
      try {
        await state!.addProject({ name: 'kabmo', path: '' });
      } catch (error) {
        failure.error = error as Error;
      }
    });

    expect(failure.error?.message).toBe('A workspace with this name already exists');
    expect(errors).toEqual(['A workspace with this name already exists']);
  });

  test('the icon and its image travel as ONE write', async () => {
    await mount();
    respond = (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') return json({ projects: [project()], accentColorOptions: [] });
      return json({
        success: true,
        changed: true,
        project: project({ icon: 'custom', customIconUrl: 'data:image/png;base64,AAA' }),
      });
    };

    await act(async () => {
      await state!.updateFields(state!.selected!, {
        customIconUrl: 'data:image/png;base64,AAA',
        icon: 'custom',
      });
    });
    await flush();

    // Two PATCHes race and the slower response wins — the uploaded icon then
    // reverted on screen. One request carries both fields.
    const patches = requests.filter((request) => request.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(JSON.parse(patches[0].body)).toEqual({
      project: { folderId: 1, customIconUrl: 'data:image/png;base64,AAA', icon: 'custom' },
    });
    expect(state?.selected?.customIconUrl).toBe('data:image/png;base64,AAA');
    expect(state?.selected?.icon).toBe('custom');
  });

  test('clearing the custom icon sends null, and the row follows the server', async () => {
    await mount();
    respond = (_url, init) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return json({ projects: [project({ icon: 'custom', customIconUrl: 'data:image/png;base64,AAA' })], accentColorOptions: [] });
      }
      return json({ success: true, changed: true, project: project({ icon: 'default' }) });
    };

    await act(async () => {
      await state!.updateFields(state!.selected!, { customIconUrl: undefined, icon: 'default' });
    });
    await flush();

    const patch = requests.find((request) => request.method === 'PATCH');
    expect(JSON.parse(patch?.body ?? '{}')).toEqual({
      project: { folderId: 1, customIconUrl: null, icon: 'default' },
    });
    expect(state?.selected?.customIconUrl).toBeUndefined();
  });
});
