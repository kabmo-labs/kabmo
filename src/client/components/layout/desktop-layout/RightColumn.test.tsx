/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * An explicit "open this view" wins over the strip's mirror in BOTH directions.
 *
 * The reported defect: on a session whose right strip already held `Files`, the
 * Stats navbar readout added a `Resources` tab but left `Files` selected and
 * drawn; the tab only appeared to work after switching chats and coming back.
 * The cause was a second writer: a request writes `layout.activeRightPanel`
 * before its tab is opened, so for one commit the stored view names `Resources`
 * while the strip still says `Files`. The mirror effect read that as a strip
 * choice and requested `Files` back, and the next commit repeated the exchange
 * in the other direction — an open/pending request that also re-applied after a
 * session switch, which is how the tab landed in the next chat too.
 *
 * The claim is the PAIR: after a request settles, the stored selection and the
 * strip's active tab name the SAME view, and no request is left pending.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Window } from 'happy-dom';
import { Group } from '@/client/components/layout/desktop-layout/resizer';
import { RightColumn } from '@/client/components/layout/desktop-layout/RightColumn';
import { SessionStateProvider } from '@/client/components/common/session-state-provider/index';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useRightOpenRequest, type RightOpenRequest } from '@/client/hooks/workspace/right-open-request';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import {
  getSessionState,
  getSessionValue,
  hydrateSession,
  resetSessionStateStore,
} from '@/shared/lib/workspace/session-state/store';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const FILES = 'files';
const STATS = 'plugin:stats:rightPanel';

let container: HTMLElement;
let requestPanel: ((panelKey: string) => void) | null = null;
let request: RightOpenRequest | null = null;

function panel(id: string, label: string, builtin: boolean): ResolvedPanel {
  return {
    id,
    side: 'right',
    title: `${label} — title`,
    label,
    name: builtin ? '' : 'Stats',
    builtin,
    requiresWorkspace: false,
    liveWhileHidden: false,
    minWidth: 200,
    defaultWidth: 420,
    defaultFraction: 0.3,
    render: () => h('div', { 'data-body': id }, `${label} body`),
  };
}

const CATALOG = [panel(FILES, 'Files', true), panel(STATS, 'Resources', false)];

/**
 * The desktop layout's own wiring, reduced to what the two effects read: the
 * restored selection, its request handle, and the rail's toggle-on-select rule.
 */
function Harness() {
  const [activeRightPanel, setActiveRightPanel] = useSessionState<string>('layout.activeRightPanel', FILES);
  const [showRightPanel, setShowRightPanel] = useSessionState<boolean>('layout.showRightPanel', true);
  const handle = useRightOpenRequest(setActiveRightPanel);
  requestPanel = handle.requestPanel;
  request = handle.request;

  const onSelectPanel = (id: string) => {
    if (activeRightPanel === id && showRightPanel) {
      setShowRightPanel(false);
      return;
    }
    setShowRightPanel(true);
    handle.requestPanel(id);
  };

  return h(
    Group,
    { orientation: 'horizontal', children: h(RightColumn, {
      panelRef: { current: null },
      open: showRightPanel,
      width: 420,
      minWidth: 200,
      maxWidth: undefined,
      catalog: CATALOG,
      shownPanel: activeRightPanel,
      selectedPanel: activeRightPanel,
      activePanelFound: true,
      hasActiveContext: false,
      refreshKey: 0,
      onRefresh: () => {},
      onOpenFile: () => {},
      onClose: () => {},
      navStyle: 'tabs',
      onSelectPanel,
      openRequest: handle.request,
    }) },
  );
}

/** Render the provider on a session id and drain the load's promise chain. */
async function show(sessionId: string): Promise<void> {
  await act(async () => {
    render(h(SessionStateProvider, { sessionId, children: h(Harness, null) }), container);
  });
  await drain();
}

async function drain(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await act(async () => {});
}

function activeTab(): string | null {
  return container.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-panel-tab') ?? null;
}

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  const target = globalThis as unknown as Record<string, unknown>;
  target.fetch = async (input: unknown, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    const sessionId = String(input).split('/sessions/')[1]?.split('/')[0] ?? 'x';
    if (method === 'POST') return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(
      JSON.stringify({ sessionId, state: { ...(getSessionState(sessionId) ?? {}) } }),
      { status: 200 },
    );
  };
});

afterAll(() => {
  restoreDomGlobals();
});

beforeEach(() => {
  resetSessionStateStore();
  requestPanel = null;
  request = null;
  container = document.createElement('div');
  document.body.appendChild(container);
  hydrateSession('s-a', {
    'layout.rightPanelTabs': { tabs: [FILES], active: FILES, home: false },
    'layout.activeRightPanel': FILES,
    'layout.showRightPanel': true,
  });
  hydrateSession('s-b', {});
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('an explicit open request beside the strip mirror', () => {
  test('the requested view is the one stored AND the one drawn, and nothing stays pending', async () => {
    await show('s-a');
    expect(activeTab()).toBe(FILES);

    await act(async () => {
      requestPanel?.(STATS);
    });
    await drain();

    // The race this test exists for: on the buggy code the two writers keep
    // swapping, so the stored selection and the drawn tab disagree in every
    // commit — whichever parity the drains happen to land on.
    expect(getSessionValue<{ active: string }>('s-a', 'layout.rightPanelTabs')?.active).toBe(STATS);
    expect(activeTab()).toBe(STATS);
    expect(getSessionValue<string>('s-a', 'layout.activeRightPanel')).toBe(STATS);
    expect(container.textContent).toContain('Resources body');

    // A pending request would be re-applied by the next commit (and by the next
    // session). Settled means the nonce stops moving.
    const settled = request?.nonce;
    await drain();
    expect(request?.nonce).toBe(settled);
  });

  test('a request that settled under one session is not replayed in the next', async () => {
    await show('s-a');
    await act(async () => {
      requestPanel?.(STATS);
    });
    await drain();

    await show('s-b');

    // A still-pending nonce would open `Resources` here on the switch commit —
    // the reported tab in every chat. A fresh session owns no tab and no pick.
    expect(container.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(getSessionValue('s-b', 'layout.rightPanelTabs')).toBeUndefined();
    expect(getSessionValue('s-b', 'layout.activeRightPanel')).toBeUndefined();
  });
});
