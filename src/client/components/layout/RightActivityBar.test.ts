/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Source Control dot belongs to that panel, so it must describe the repo the
 * panel is on. It polled the workspace root instead: with `projects/a` selected
 * the dot answered for the root's repository, and it kept answering for the repo
 * the user had just left until the next poll.
 *
 * The dot now reads the `git:<root>\0<repo>` topic, so this drives it through a
 * real realtime server: the topic a scope is subscribed to IS the assertion —
 * a dot that answers for the wrong tree subscribes to the wrong topic.
 *
 * Rendered with `h()` (no JSX) against happy-dom.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { RightActivityBar } from '@/client/components/layout/RightActivityBar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { primeChamberSettings, readChamberSetting, writeSetting } from '@/shared/lib/settings/client';
import { PANEL_ORDER_SETTING_KEY } from '@/shared/lib/workspace/panel-order';
import { RIGHT_PANEL_TYPES } from '@/shared/lib/workspace/right-panels';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const nativeFetch = Bun.fetch;

const ROOT = '/ws';
const SESSION = 'new-activity-dot';

let container: HTMLElement;
let server: RealtimeTestServer;
/** Every scope the dot subscribed to, so the topic it asked for is assertable. */
const subscribedScopes: string[] = [];

/** The picker the panel owns: writes the slot the dot follows. */
function Picker({ repo }: { repo: string }) {
  const { setActiveRepo } = useRepoScope(ROOT);
  return h('button', { id: 'pick', onClick: () => setActiveRepo(repo) }, 'pick');
}

// Installed per CASE, not per file: another suite's teardown can strip
// `window` mid-file when the runner interleaves files, and this hook's
// first render would then throw `window is not defined`.
beforeEach(async () => {
  // Only `projects/a` has anything to report, so the dot is a verdict on which
  // scope it asked about.
  const status = (changes: unknown[]) => ({ changes, branch: 'main', branches: ['main'], remoteBranches: [] });
  const resolver: TopicResolver = async (topic) => {
    subscribedScopes.push(topic);
    return topic === gitTopic(`${ROOT}\u0000projects/a`) ? status([{ path: 'a.ts', status: ' M' }]) : status([]);
  };
  server = await startRealtimeTestServer(new Map<string, TopicResolver>([
    [gitTopic(`${ROOT}\u0000.`), resolver],
    [gitTopic(`${ROOT}\u0000projects/a`), resolver],
  ]));
  const win = new Window({ url: `http://127.0.0.1:${server.port}` });
  installDomGlobals(win);
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/state')) {
      return json({ sessionId: SESSION, state: { 'workspace.activeRepo': { root: ROOT, repo: 'projects/a' } } });
    }
    if (url.includes('reposOnly')) return json({ repos: ['.', 'projects/a', 'projects/b'] });
    return json({ changes: [] });
  };
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = nativeFetch;
  restoreDomGlobals();
});

afterEach(() => {
  // UNMOUNT, not just detach. A detached container keeps its Preact tree alive,
  // and any effect that subscribes to a module-level store will re-render it —
  // which throws once `afterAll` has restored the runner's globals and there is
  // no `window`. The panel under test reads a plugin store now, so a detached
  // tree is a live tree that fails in a later file.
  if (container) {
    render(null, container);
    container.remove();
  }
  subscribedScopes.length = 0;
  // The settings snapshot is module state shared by every suite in one `bun
  // test` process, and a case here writes a panel order into it.
  primeChamberSettings({});
  resetRealtimeClient();
  server?.stop();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h('div', null, h(Picker, { repo: '.' }), h(RightActivityBar, {
          activePanel: 'git',
          onChangePanel: () => {},
          isPanelOpen: true,
          hasActiveContext: true,
          activeProjectPath: ROOT,
          refreshKey: 0,
        })),
      }),
      container,
    );
  });
  await server.waitForTopic(gitTopic(`${ROOT}\u0000projects/a`), (value) => value !== null);
  for (let i = 0; i < 20; i += 1) await act(async () => {});
  return container;
}

const dot = () => Boolean(container.querySelector('[title="Ada perubahan git"]'));

describe('RightActivityBar git dot', () => {
  test('reports the selected repo, and follows the picker to the root', async () => {
    await mount();

    // The stored pick is projects/a, so the dot asked about THAT topic — not
    // the workspace root's.
    expect(subscribedScopes).toContain(gitTopic(`${ROOT}\u0000projects/a`));
    expect(dot()).toBe(true);

    await act(async () => {
      (container.querySelector('#pick') as HTMLButtonElement).click();
    });
    await server.waitForTopic(gitTopic(`${ROOT}\u0000.`), (value) => value !== null);
    await act(async () => {
      for (let i = 0; i < 8; i += 1) await Promise.resolve();
    });

    // The picker moved to the root: the dot follows to that topic and clears.
    expect(subscribedScopes).toContain(gitTopic(`${ROOT}\u0000.`));
    expect(dot()).toBe(false);
  });
});

/** The bar's buttons, in the order they are drawn. */
const buttonLabels = () =>
  [...container.querySelectorAll('nav button[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '');

const buttonFor = (label: string) =>
  [...container.querySelectorAll('nav button[aria-label]')].find(
    (el) => el.getAttribute('aria-label') === label,
  ) as HTMLElement;

/**
 * A drag from one button to another, as the browser delivers it.
 *
 * `dataTransfer` is a minimal stand-in: happy-dom has no `DataTransfer`, and
 * the handlers read only `setData`/`dropEffect`/`effectAllowed`.
 */
async function dragOnto(from: string, to: string) {
  const transfer = {
    data: {} as Record<string, string>,
    effectAllowed: '',
    dropEffect: 'move',
    setData(type: string, value: string) {
      this.data[type] = value;
    },
    getData(type: string) {
      return this.data[type] ?? '';
    },
  };
  const fire = (element: HTMLElement, type: string) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    element.dispatchEvent(event);
  };
  await act(async () => {
    fire(buttonFor(from), 'dragstart');
  });
  await act(async () => {
    fire(buttonFor(to), 'dragover');
  });
  // The drop is what commits — a `dragend` alone is a cancelled gesture.
  await act(async () => {
    fire(buttonFor(to), 'drop');
  });
  await act(async () => {
    fire(buttonFor(from), 'dragend');
  });
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

describe('RightActivityBar panel order', () => {
  test('a drag reorders the bar and persists the new order', async () => {
    primeChamberSettings({});
    await mount();

    // The shipped order, before anything is dragged.
    expect(buttonLabels()[0]).toBe('Context & Telemetry');

    // Todos is drawn below Context; drag it onto Context's slot.
    await dragOnto('Todos', 'Context & Telemetry');

    const drawn = buttonLabels();
    // Todos was dragged UP onto Context, so it lands just ABOVE it — the
    // insertion point is the target's own index (the same rule `QueueList`
    // uses), and every other button keeps its relative order.
    expect(drawn.slice(0, 3)).toEqual(['Todos', 'Context & Telemetry', 'Files']);

    // The write is what makes the order survive a reload: it goes to the
    // GLOBAL setting, not to this session's layout state.
    const stored = readChamberSetting<string[]>(PANEL_ORDER_SETTING_KEY);
    expect(stored?.slice(0, 3)).toEqual(['todo', 'context', 'files']);
    expect(stored).toHaveLength(RIGHT_PANEL_TYPES.length);
  });

  test('a stored order is drawn on the first render', async () => {
    primeChamberSettings({});
    writeSetting(PANEL_ORDER_SETTING_KEY, ['plan', ...RIGHT_PANEL_TYPES.filter((id) => id !== 'plan')]);
    await mount();

    expect(buttonLabels()[0]).toBe('Plan (sesi ini)');
  });

  test('a cancelled drag writes nothing', async () => {
    primeChamberSettings({});
    await mount();
    const before = buttonLabels();

    // `dragstart` + `dragover` with NO drop is what Esc produces: the preview
    // moved while the gesture ran, and the stored order must not follow it.
    const transfer = {
      data: {} as Record<string, string>,
      effectAllowed: '',
      dropEffect: 'none',
      setData(type: string, value: string) {
        this.data[type] = value;
      },
      getData(type: string) {
        return this.data[type] ?? '';
      },
    };
    const fire = (element: HTMLElement, type: string) => {
      const event = new window.Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      element.dispatchEvent(event);
    };
    await act(async () => {
      fire(buttonFor('Todos'), 'dragstart');
    });
    await act(async () => {
      fire(buttonFor('Context & Telemetry'), 'dragover');
    });
    await act(async () => {
      fire(buttonFor('Todos'), 'dragend');
    });
    for (let i = 0; i < 8; i += 1) await act(async () => {});

    expect(buttonLabels()).toEqual(before);
    expect(readChamberSetting<string[]>(PANEL_ORDER_SETTING_KEY)).toBeUndefined();
  });
});
