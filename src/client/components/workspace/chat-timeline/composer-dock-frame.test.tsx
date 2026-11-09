/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pending chat's dock is the REAL timeline's dock.
 *
 * The generating indicator is drawn from one component, but its height in the
 * pane came from two different wrappers: the real timeline docked it in
 * `ComposerDock` (`p-4 pt-1`), while the pending `new-…` chat kept the landing
 * page's centred `p-8` column with a `space-y-3` stack. Measured with the
 * built CSS at 1200x1400: the indicator sat **141px** above the pane's bottom
 * while the spawn was in flight (`Loading…`) and **113px** once the run
 * streamed (`Thinking…`) — the row jumped 28px at adoption, which is why the
 * two states read as two different indicators.
 *
 * Both are `ComposerDockFrame` now. What this suite pins is that the frame is
 * the ONE wrapper for the pending dock, that the indicator is inside it in both
 * identity states, and that the landing page — which has no run to report — is
 * the only state that keeps the centred column.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { EmptyWorkspacePrompt } from '@/client/components/workspace/chat-timeline/EmptyWorkspacePrompt';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';
import { resetHarnessesStore } from '@/client/hooks/models/harness-catalog';
import { invalidateModelsCache } from '@/shared/lib/models/client';

let container: HTMLElement;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  // The composer measures its textarea through the BARE global (`auto-grow.ts`),
  // which happy-dom only provides on the window it installed.
  (globalThis as unknown as Record<string, unknown>).getComputedStyle = window.getComputedStyle.bind(window);
});
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  silenceRealtime();
  resetHarnessesStore();
  invalidateModelsCache();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/harness')) {
      return Response.json({ harnesses: [], configs: {}, providerSupport: {} });
    }
    if (url.startsWith('/api/models')) {
      return Response.json({ models: {}, modelList: [], selectedModel: null, defaultModel: null, thinkingLevels: {} });
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
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 30);
    await promise;
  });
}

const USER_ROW = { id: 'msg-1-user', role: 'user', content: 'halo', date: 'Today, 12:22 PM' };

describe('pending chat dock frame', () => {
  test('the indicator rides the dock frame in both identity states', async () => {
    // `Loading…` — the spawn has not answered, so neither half is known.
    const loading = mount({ messages: [USER_ROW], isGenerating: true, generatingVerb: 'Thinking' });
    await settle();
    const loadingDock = loading.querySelector('[data-composer-dock]');
    const loadingIndicator = loading.querySelector('#generating-docked-indicator');
    expect(loadingDock).not.toBeNull();
    expect(loadingIndicator).not.toBeNull();
    expect(loadingDock!.contains(loadingIndicator!)).toBe(true);
    expect(loading.textContent).toContain('Loading');

    render(null, container);
    // `Thinking…` — same run, identity resolved.
    const thinking = mount({
      messages: [USER_ROW],
      isGenerating: true,
      generatingVerb: 'Thinking',
      provider: 'kenari',
      modelName: 'DeepSeek V4',
    });
    await settle();
    const thinkingDock = thinking.querySelector('[data-composer-dock]');
    const thinkingIndicator = thinking.querySelector('#generating-docked-indicator');
    expect(thinkingDock).not.toBeNull();
    expect(thinkingDock!.contains(thinkingIndicator!)).toBe(true);
    expect(thinking.textContent).toContain('Thinking');

    // The one fact: no second wrapper may change between the two states.
    expect(thinkingDock!.className).toBe(loadingDock!.className);
  });

  test('the frame carries the real dock padding on both layouts', async () => {
    const desktop = mount({ messages: [USER_ROW], isGenerating: true });
    await settle();
    const desktopDock = desktop.querySelector('[data-composer-dock]') as HTMLElement;
    // The dock's box, not the landing page's `p-8`.
    expect(desktopDock.className).toContain('p-4');
    expect(desktopDock.className).not.toContain('p-8');

    render(null, container);
    const mobile = mount({ messages: [USER_ROW], isGenerating: true, variant: 'mobile' });
    await settle();
    const mobileDock = mobile.querySelector('[data-composer-dock]') as HTMLElement;
    expect(mobileDock.className).toContain('px-3');
    expect(mobileDock.className).not.toContain('p-8');
  });

  test('the landing page keeps the centred column and draws no dock', async () => {
    const el = mount({ messages: [], isGenerating: false });
    await settle();
    expect(el.querySelector('[data-composer-dock]')).toBeNull();
    const column = el.firstElementChild?.firstElementChild as HTMLElement;
    expect(column.className).toContain('my-auto');
    expect(column.className).toContain('justify-center');
  });
});
