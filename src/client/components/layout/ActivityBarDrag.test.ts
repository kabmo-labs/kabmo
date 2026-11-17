/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Rail drag: reorder inside a rail, and move a panel to the OTHER rail.
 *
 * Both are one gesture and the store that owns the ORDER decides the commit:
 * `omp_right_panel_order` on the right, the dock's placement list on the left.
 * The assertions are therefore on the store, not on a component's local flag —
 * a drag that only moved a button until the next render would pass a visual
 * check and lose the arrangement.
 *
 * Rendered with `h()` (no JSX) against happy-dom. `dataTransfer` is a minimal
 * stand-in: happy-dom has none, and the handlers read `types`, `setData`,
 * `getData`, `dropEffect` and `effectAllowed`.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { ActivityBar } from '@/client/components/layout/ActivityBar';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { primeKabmoSettings, readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import { PANEL_ORDER_SETTING_KEY } from '@/shared/lib/workspace/panel-order';
import { LEFT_DOCK_SETTING_KEY, readLeftDock } from '@/shared/lib/workspace/left-dock';
import { RIGHT_PANEL_TYPES } from '@/shared/lib/workspace/right-panels';
import { resetRealtimeClient } from '@/shared/lib/realtime/client';
import { gitTopic } from '@/shared/lib/realtime/protocol';
import { startRealtimeTestServer, type RealtimeTestServer } from '@/test-support/realtime-server';
import { installDomGlobals, pristineWebSocket, restoreDomGlobals } from '@/test-support/pristine-globals';
import type { TopicResolver } from '@/server/lib/realtime/hub.server';

const nativeFetch = Bun.fetch;
const ROOT = '/ws';
const SESSION = 'activity-drag';

let container: HTMLElement;
let server: RealtimeTestServer;

beforeEach(async () => {
  const status = (changes: unknown[]) => ({ changes, branch: 'main', branches: ['main'], remoteBranches: [] });
  const resolver: TopicResolver = async (topic) =>
    topic === gitTopic(`${ROOT}\u0000projects/a`) ? status([{ path: 'a.ts', status: ' M' }]) : status([]);
  server = await startRealtimeTestServer(
    new Map<string, TopicResolver>([
      [gitTopic(`${ROOT}\u0000.`), resolver],
      [gitTopic(`${ROOT}\u0000projects/a`), resolver],
    ]),
  );
  installDomGlobals(new Window({ url: `http://127.0.0.1:${server.port}` }));
  const target = globalThis as unknown as Record<string, unknown>;
  target.WebSocket = pristineWebSocket;
  target.fetch = async (input: unknown) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
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
  if (container) {
    render(null, container);
    container.remove();
  }
  primeKabmoSettings({});
  resetRealtimeClient();
  server?.stop();
});

interface PanelTransfer {
  data: Record<string, string>;
  effectAllowed: string;
  dropEffect: string;
  readonly types: string[];
  setData: (type: string, value: string) => void;
  getData: (type: string) => string;
}

function panelTransfer(): PanelTransfer {
  return {
    data: {},
    effectAllowed: '',
    dropEffect: 'move',
    get types() {
      return Object.keys(this.data);
    },
    setData(type: string, value: string) {
      this.data[type] = value;
    },
    getData(type: string) {
      return this.data[type] ?? '';
    },
  };
}

function dragFire(element: HTMLElement, type: string, transfer: PanelTransfer) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  element.dispatchEvent(event);
}

/** The bar's buttons, in the order they are drawn. */
const buttonLabels = () =>
  [...container.querySelectorAll('nav button[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '');

const buttonFor = (label: string) =>
  [...container.querySelectorAll('nav button[aria-label]')].find(
    (el) => el.getAttribute('aria-label') === label,
  ) as HTMLElement;

const rail = (side: 'left' | 'right') =>
  container.querySelector(`nav[aria-label="${side === 'left' ? 'Left' : 'Right'} panel views"]`) as HTMLElement;

const railLabels = (side: 'left' | 'right') =>
  [...rail(side).querySelectorAll('button[aria-label]')].map((el) => el.getAttribute('aria-label') ?? '');

/** Drain Preact and the channel's frames after a gesture. */
async function settle() {
  for (let i = 0; i < 8; i += 1) await act(async () => {});
}

async function mountRight() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(ActivityBar, {
          side: 'right',
          activePanel: 'git',
          onChangePanel: () => {},
          isPanelOpen: true,
          hasActiveContext: true,
          activeProjectPath: ROOT,
        }),
      }),
      container,
    );
  });
  await settle();
}

/** Both rails in one tree: a drag that crosses them is one document gesture. */
async function mountPair() {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    render(
      h(SessionStateProvider, {
        sessionId: SESSION,
        children: h(
          'div',
          null,
          h(ActivityBar, {
            side: 'left',
            activePanel: 'sessions',
            onChangePanel: () => {},
            isPanelOpen: true,
            hasActiveContext: true,
            activeProjectPath: ROOT,
          }),
          h(ActivityBar, {
            side: 'right',
            activePanel: 'git',
            onChangePanel: () => {},
            isPanelOpen: true,
            hasActiveContext: true,
            activeProjectPath: ROOT,
          }),
        ),
      }),
      container,
    );
  });
  await settle();
}

/** A drag from one button to another, as the browser delivers it. */
async function dragOnto(from: string, to: string) {
  const transfer = panelTransfer();
  await act(async () => {
    dragFire(buttonFor(from), 'dragstart', transfer);
  });
  await act(async () => {
    dragFire(buttonFor(to), 'dragover', transfer);
  });
  await act(async () => {
    dragFire(buttonFor(to), 'drop', transfer);
  });
  await act(async () => {
    dragFire(buttonFor(from), 'dragend', transfer);
  });
  await settle();
}

/** Drag a button onto the OTHER rail, as the browser delivers it. */
async function dragToRail(from: string, side: 'left' | 'right') {
  const source = buttonFor(from);
  const transfer = panelTransfer();
  await act(async () => {
    dragFire(source, 'dragstart', transfer);
  });
  await act(async () => {
    dragFire(rail(side), 'dragover', transfer);
  });
  await act(async () => {
    dragFire(rail(side), 'drop', transfer);
  });
  await act(async () => {
    dragFire(source, 'dragend', transfer);
  });
  await settle();
}

describe('ActivityBar cross-rail drag', () => {
  test('dragging a right panel onto the left rail places it there and turns the rail on', async () => {
    primeKabmoSettings({});
    await mountPair();

    expect(railLabels('left')).toEqual(['Sessions']);
    await dragToRail('Source Control', 'left');

    expect(readLeftDock()).toEqual({ enabled: true, panels: ['git'] });
    expect(railLabels('left')).toContain('Source Control');
    expect(railLabels('right')).not.toContain('Source Control');
  });

  test('dragging a left panel onto the right rail sends it back', async () => {
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: ['files'] } });
    await mountPair();
    expect(railLabels('left')).toEqual(['Sessions', 'Files']);

    await dragToRail('Files', 'right');

    expect(readLeftDock().panels).toEqual([]);
    expect(railLabels('left')).toEqual(['Sessions']);
    expect(railLabels('right')).toContain('Files');
  });

  test('the left rail reorders its placement list, and the order is the store', async () => {
    primeKabmoSettings({ [LEFT_DOCK_SETTING_KEY]: { enabled: true, panels: ['git', 'files'] } });
    await mountPair();
    expect(railLabels('left')).toEqual(['Sessions', 'Source Control', 'Files']);

    await dragOnto('Files', 'Source Control');

    expect(readLeftDock().panels).toEqual(['files', 'git']);
    expect(railLabels('left')).toEqual(['Sessions', 'Files', 'Source Control']);
  });
});

describe('ActivityBar panel order', () => {
  test('a dragover in the same tick as dragstart still reorders (the ref is the truth)', async () => {
    // A real browser can deliver the first `dragover` before Preact has
    // re-rendered the `dragstart` state. Reading the rendered drag id there
    // classified our own drag as a foreign one and the reorder was dropped —
    // measured in WebKit with a synthetic DataTransfer.
    primeKabmoSettings({});
    await mountRight();
    const transfer = panelTransfer();
    const source = buttonFor('Files');
    const target = buttonFor('Context & Telemetry');

    await act(async () => {
      dragFire(source, 'dragstart', transfer);
      dragFire(target, 'dragover', transfer);
      dragFire(target, 'drop', transfer);
      dragFire(source, 'dragend', transfer);
    });
    await settle();

    expect(buttonLabels().slice(0, 2)).toEqual(['Files', 'Context & Telemetry']);
    expect(readKabmoSetting<string[]>(PANEL_ORDER_SETTING_KEY)?.slice(0, 2)).toEqual(['files', 'context']);
  });

  test('a drag reorders the bar and persists the new order', async () => {
    primeKabmoSettings({});
    await mountRight();
    expect(buttonLabels()[0]).toBe('Context & Telemetry');

    await dragOnto('Todos', 'Context & Telemetry');

    // Todos was dragged UP onto Context, so it lands just ABOVE it.
    expect(buttonLabels().slice(0, 3)).toEqual(['Todos', 'Context & Telemetry', 'Files']);
    const stored = readKabmoSetting<string[]>(PANEL_ORDER_SETTING_KEY);
    expect(stored?.slice(0, 3)).toEqual(['todo', 'context', 'files']);
    expect(stored).toHaveLength(RIGHT_PANEL_TYPES.length);
  });

  test('a stored order is drawn on the first render', async () => {
    primeKabmoSettings({});
    writeSetting(PANEL_ORDER_SETTING_KEY, ['plan', ...RIGHT_PANEL_TYPES.filter((id) => id !== 'plan')]);
    await mountRight();
    expect(buttonLabels()[0]).toBe('Plan (sesi ini)');
  });

  test('a cancelled drag writes nothing', async () => {
    primeKabmoSettings({});
    await mountRight();
    const before = buttonLabels();
    const transfer = panelTransfer();

    // `dragstart` + `dragover` with NO drop is what Esc produces: the preview
    // moved while the gesture ran, and the stored order must not follow it.
    await act(async () => {
      dragFire(buttonFor('Todos'), 'dragstart', transfer);
    });
    await act(async () => {
      dragFire(buttonFor('Context & Telemetry'), 'dragover', transfer);
    });
    await act(async () => {
      dragFire(buttonFor('Todos'), 'dragend', transfer);
    });
    await settle();

    expect(buttonLabels()).toEqual(before);
    expect(readKabmoSetting<string[]>(PANEL_ORDER_SETTING_KEY)).toBeUndefined();
  });
});
