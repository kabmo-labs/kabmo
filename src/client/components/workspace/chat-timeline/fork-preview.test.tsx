/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The fork composer draws the history it is about to continue.
 *
 * A fork opens as an empty `new-…` chat, so the pending composer was the whole
 * screen: the operator chose the branch's first turn with none of the source
 * transcript in sight, and after moving "Fork from" the previous source's rows
 * were all there was. Asserted from the mounted surface:
 *
 *  - the preview rows render above the composer;
 *  - the "Fork from" picker stays reachable WHILE those rows are drawn (the
 *    docked branch used to drop the target row), and choosing another session
 *    reports it, which is what swaps the transcript.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';

import { EmptyWorkspacePrompt } from '@/client/components/workspace/chat-timeline/EmptyWorkspacePrompt';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';
import { silenceRealtime, restoreRealtime } from '@/test-support/silent-socket';
import type { ChatMessageData, WorkspaceFolderData } from '@/shared/types';

let container: HTMLElement;
/** The runner's own fetch: a stub left installed poisons every later suite. */
const originalFetch = Bun.fetch;

beforeAll(() => {
  installDomGlobals(new Window({ url: 'http://localhost' }));
  (globalThis as unknown as Record<string, unknown>).getComputedStyle = window.getComputedStyle.bind(window);
});
afterAll(() => restoreDomGlobals());

beforeEach(() => {
  silenceRealtime();
  // Only the composer's catalog reads are answered; nothing here asserts them.
  globalThis.fetch = (async () => Response.json({})) as unknown as typeof fetch;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  render(null, container);
  container.remove();
  restoreRealtime();
});

const SOURCE_ROWS: ChatMessageData[] = [
  { id: 'u1', role: 'user', content: 'source question' },
  { id: 'a1', role: 'ai', content: 'source answer' },
];

const FOLDERS = [{
  id: 1,
  name: 'kabmo',
  isExpanded: true,
  sessions: [
    { id: 'sess-a', title: 'Branch A', folder_id: 1, is_archived: 0 },
    { id: 'sess-b', title: 'Branch B', folder_id: 1, is_archived: 0 },
  ],
  hasMore: false,
  totalSessions: 2,
}] as unknown as WorkspaceFolderData[];

function mount(props: Record<string, unknown>) {
  act(() => {
    render(h(EmptyWorkspacePrompt, {
      folders: FOLDERS,
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
      parentSessionId: 'sess-a',
      onParentSessionChange: () => {},
      branchLabel: 'Fork from',
      branchAllowNone: false,
      branchPreview: { messages: SOURCE_ROWS, loading: false, error: null },
      ...props,
    } as never), container);
  });
  return container;
}

async function settle(): Promise<void> {
  // The mocked catalog reads resolve through microtasks; drain them instead of
  // waiting on a wall clock.
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

describe('fork preview in the pending composer', () => {
  test('the source transcript renders above an otherwise empty chat', async () => {
    const el = mount({});
    await settle();
    expect(el.textContent).toContain('source question');
    // The assistant row is rendered through the answer renderer, which
    // capitalizes the first letter; what matters is the row is there.
    expect(el.textContent).toMatch(/source answer/i);
  });

  test('preview rows belong to the source: no chat-owning actions on them', async () => {
    const el = mount({});
    await settle();
    expect(el.querySelector('[aria-label="Fork this session from this message"]')).toBeNull();
    expect(el.querySelector('[aria-label="Undo this message"]')).toBeNull();
  });

  test('the fork picker is dock furniture, not part of the transcript', async () => {
    const el = mount({});
    await settle();
    const dock = el.querySelector('[data-composer-dock]');
    const trigger = el.querySelector('[data-testid="parent-session-picker"]');
    expect(trigger, 'the fork picker is missing').not.toBeNull();
    // It used to sit above the preview rows, at the top of the pane; the control
    // it affects is the composer, so it belongs inside the dock.
    expect(dock?.contains(trigger as Node), 'the fork picker is outside the composer dock').toBe(true);
  });

  test('"Fork from" stays reachable while the preview is docked, and reports a new source', async () => {
    const picked: string[] = [];
    const el = mount({ onParentSessionChange: (id: string | null) => picked.push(String(id)) });
    await settle();

    const trigger = el.querySelector('[data-testid="parent-session-picker"]');
    expect(trigger, 'the fork picker disappeared once the preview docked').not.toBeNull();
    act(() => {
      (trigger as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();

    const other = el.querySelector('[data-testid="parent-candidate"][data-session-id="sess-b"]');
    expect(other, 'the other source is not offered').not.toBeNull();
    act(() => {
      (other as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    expect(picked).toEqual(['sess-b']);
  });
});
