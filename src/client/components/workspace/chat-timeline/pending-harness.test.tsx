/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending chat's composer actually CARRYING the harness.
 *
 * The tab strip already knew how to report a pick (`harness-tabs.test.tsx`), and
 * the model dropdown already drew the mark. What was missing was the wire
 * between them and the spawn: `EmptyWorkspacePrompt` was never handed
 * `harness` / `onSelectHarness`, so a click changed the strip's local view and
 * nothing else — the server then spawned `omp-rpc` for an `opencode` pick.
 *
 * Both halves are asserted here, from the surface the user presses:
 *  - a harness passed in shows its own mark on the model trigger;
 *  - clicking another tab calls `onSelectHarness` with that id.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { EmptyWorkspacePrompt } from '@/client/components/workspace/chat-timeline/EmptyWorkspacePrompt';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';
import { resetHarnessesStore } from '@/client/hooks/models/use-harnesses';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import type { HarnessSummary } from '@/shared/types/harness';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The composer measures its textarea through the BARE global (`auto-grow.ts`),
  // which happy-dom only provides on the window it installed.
  (globalThis as unknown as Record<string, unknown>).getComputedStyle = window.getComputedStyle.bind(window);
});
afterAll(() => restoreDomGlobals());

const HARNESSES: HarnessSummary[] = [
  { id: 'omp-rpc', label: 'omp', transport: 'rpc', builtIn: true, canLaunch: true, enabled: true, probe: null },
  {
    id: 'opencode',
    label: 'opencode',
    transport: 'acp',
    canLaunch: true,
    enabled: true,
    probe: {
      harness: 'opencode',
      capabilities: {
        configModel: 1, configThinking: 0, configMode: 0, modeValues: [],
        loadSession: false, listSessions: false, forkSession: false, deleteSession: false,
        resumeSession: false, closeSession: false, hasUsage: false, hasPlan: false, steerMode: null,
      },
      models: [{ value: 'opencode/gpt-5', name: 'GPT-5' }],
      thinking: [], modes: [], probedAt: Date.now(),
    },
  },
];

beforeEach(() => {
  silenceRealtime();
  // Both catalogs are MODULE state shared by every suite in this process. Bun
  // imports every file before any test runs, so an earlier file's read is
  // already cached and this suite's stub would never be asked — the picker then
  // renders with no harnesses and no models, and the assertions below fail for a
  // reason that has nothing to do with the wiring.
  resetHarnessesStore();
  invalidateModelsCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/harness')) {
      return Response.json({ harnesses: HARNESSES, configs: {}, providerSupport: {} });
    }
    if (url.startsWith('/api/models')) {
      // One row: the trigger draws its mark only beside a SELECTION, and the
      // question here is which mark it is, not what the list holds.
      return Response.json({
        models: { openai: 'OpenAI' },
        modelList: [{ id: 'gpt-5', name: 'GPT-5', provider: 'openai', thinkingLevels: ['auto'] }],
        // The trigger draws its mark only beside a SELECTION, and a persisted
        // pick is where one comes from on a chat that has not spawned.
        selectedModel: { id: 'gpt-5', name: 'GPT-5', provider: 'openai', thinkingLevels: ['auto'] },
        defaultModel: null,
        thinkingLevels: {},
      });
    }
    return Response.json({});
  }) as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreRealtime();
});

function mount(props: Record<string, unknown>) {
  act(() => {
    render(h(EmptyWorkspacePrompt, {
      selectedFolderId: 1,
      setSelectedFolderId: () => {},
      inputValue: '',
      setInputValue: () => {},
      onSend: () => {},
      isGenerating: false,
      accessMode: 'always-ask',
      onAccessModeChange: () => {},
      composerModelRef: { current: null },
      deferredComposerPickRef: { current: null },
      ...props,
    } as never), container);
  });
  return container;
}

/** The model catalog is read through a promise chain; one macrotask drains it. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

describe('pending composer harness wiring', () => {
  test('the mark on the model trigger is the harness the chat will spawn on', async () => {
    const el = mount({ harness: 'opencode', onSelectHarness: () => {} });
    await settle();
    expect(el.querySelector('svg[data-harness="opencode"]')).not.toBeNull();
  });

  test('picking another tab reports the harness id to the spawn path', async () => {
    const picked: string[] = [];
    const el = mount({ harness: 'omp-rpc', onSelectHarness: (id: string) => picked.push(id) });
    await settle();

    const trigger = el.querySelector('[data-model-dropdown-root] button');
    expect(trigger, 'no model trigger').not.toBeNull();
    act(() => {
      (trigger as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    const tabs = [...el.querySelectorAll('[role="tab"]')];
    // A tab is the MARK ONLY now, so the accessible name is what identifies it —
    // there is no label text to search for.
    const opencode = tabs.find((tab) => tab.getAttribute('aria-label') === 'opencode');
    expect(opencode, 'the opencode tab is not offered').toBeDefined();
    act(() => {
      (opencode as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(picked).toEqual(['opencode']);
  });
});
