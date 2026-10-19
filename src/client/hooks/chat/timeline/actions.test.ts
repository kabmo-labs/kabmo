/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The composer's send interception, driven through a mounted hook.
 *
 * `/btw …` must be answered by the side-question panel and never leave the
 * client — omp implements `/btw` in its TUI only, so a forwarded token would
 * reach the model as literal text. The interception has to run BEFORE the
 * TUI-only guard, because `btw` is listed in that table too; getting the order
 * wrong silently refuses the one command the chamber does answer.
 *
 * Pinned here: a btw draft fires `omp:btw` (question + attachments) and never
 * calls the send path, while clearing the composer; a plugin's
 * `commandPaletteAction` runs the plugin with its parsed args and is likewise
 * never sent; a plain prompt passes through untouched; a TUI-only command is
 * refused locally with a notice and the draft is KEPT; and while a turn streams
 * a plain submit is queued with the composer's model/access snapshot.
 */

import { afterEach, beforeAll, afterAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import type { CommandActionContext } from '@kabmo-labs/plugin-sdk';
import type { Attachment, ChatMessageData } from '@/shared/types';
import { registerListSlot, resetListSlots } from '@/client/lib/plugins/list-slots';
import { setPluginContext } from '@/client/lib/plugins/context';
import {
  useChatTimelineActions,
  type ChatTimelineActionsDeps,
  type ChatTimelineActionsResult,
} from '@/client/hooks/chat/timeline/actions';

const DOM_GLOBALS = ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'Event', 'CustomEvent'] as const;
/** The runner's own globals, restored on teardown so later files still have them. */
const native: Partial<Record<(typeof DOM_GLOBALS)[number], unknown>> = {};

let container: HTMLElement | undefined;
let actions: ChatTimelineActionsResult | null = null;
/** Attachments handed to the next send click. */
let attachmentsForClick: Attachment[] = [];

function Probe({ deps }: { deps: ChatTimelineActionsDeps }) {
  actions = useChatTimelineActions(deps);
  return h('div', { id: 'probe' }, h('button', {
    id: 'send',
    onClick: () => {
      void actions?.handleSend(attachmentsForClick, undefined);
    },
  }, 'send'));
}

beforeAll(() => {
  const win = new Window({ url: 'http://localhost' });
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (!(key in native)) native[key] = target[key];
    target[key] = (win as unknown as Record<string, unknown>)[key];
  }
});

afterAll(() => {
  const target = globalThis as unknown as Record<string, unknown>;
  for (const key of DOM_GLOBALS) {
    if (native[key] === undefined) delete target[key];
    else target[key] = native[key];
  }
});

afterEach(() => {
  if (container) render(null, container);
  container?.remove();
  actions = null;
  attachmentsForClick = [];
  resetListSlots();
  setPluginContext(null, null);
});

interface Recorded {
  /** Each send with the SCOPE (`sessionId`) the deps record carried when the
   *  callback was built. */
  sends: Array<{ text: string; attachments: Attachment[]; scope: string | null }>;
  queued: Array<{ text: string; attachments: Attachment[]; model: unknown }>;
  drafts: string[];
  notices: string[];
  btw: Array<{ question: string; attachments?: Attachment[] }>;
  deps: ChatTimelineActionsDeps;
}

/** The whole deps record, with the observed fields replaced by recorders. */
function makeRecorded(overrides: Partial<ChatTimelineActionsDeps> = {}): Recorded {
  const sends: Recorded['sends'] = [];
  const queued: Recorded['queued'] = [];
  const drafts: string[] = [];
  const notices: string[] = [];
  const btw: Recorded['btw'] = [];
  const messages: ChatMessageData[] = [];
  const scope: string | null = overrides.sessionId ?? 'sess-1';
  const deps: ChatTimelineActionsDeps = {
    inputValue: 'hello world',
    setInputValue: (v) => {
      drafts.push(v);
    },
    setInputAttachments: () => {},
    isGenerating: false,
    chatRunning: false,
    isOmpSession: true,
    sessionId: 'sess-1',
    folders: [],
    selectedFolderId: null,
    appSettings: {},
    messageQueue: [],
    enqueueMessage: (item) => {
      queued.push({ text: item.text, attachments: item.attachments, model: item.model });
    },
    removeMessage: () => {},
    executeSend: async (text, attachments) => {
      sends.push({ text, attachments, scope });
      return { ok: true, busy: false };
    },
    steerOmpAgent: async () => ({ ok: true, busy: false }),
    ompAgent: {} as ChatTimelineActionsDeps['ompAgent'],
    abortControllerRef: { current: null },
    setGenerating: () => {},
    stopHoldRef: { current: false },
    persistMessages: () => {},
    setLocalMessages: (next) => {
      const resolved = typeof next === 'function' ? next(messages) : next;
      messages.splice(0, messages.length, ...resolved);
    },
    localMessagesRef: { current: messages },
    pendingComposerModelRef: { current: null },
    pendingThinkingLevelRef: { current: null },
    composerModelRef: { current: null },
    deferredComposerPickRef: { current: null },
    accessModeRef: { current: 'always-ask' },
    setSearchParams: () => {},
    reportActionError: () => {},
    ...overrides,
  };
  window.addEventListener('omp:btw', ((e: CustomEvent<{ question: string; attachments?: Attachment[] }>) => {
    btw.push(e.detail);
  }) as EventListener);
  return { sends, queued, drafts, notices, btw, deps };
}

async function mount(deps: ChatTimelineActionsDeps) {
  container ??= document.body.appendChild(document.createElement('div'));
  await act(async () => {
    render(h(Probe, { deps }), container as HTMLElement);
  });
  await act(async () => {});
  return {
    clickSend: async () => {
      await act(async () => {
        (container?.querySelector('#send') as HTMLButtonElement).click();
      });
      // prepareQueuedAttachments resolves over a microtask chain.
      for (let i = 0; i < 5; i += 1) await act(async () => {});
    },
  };
}

describe('handleSend', () => {
  test('a /btw draft opens the panel, is not sent, and clears the composer', async () => {
    const rec = makeRecorded({ inputValue: '/btw what changed in this file?' });
    const ui = await mount(rec.deps);
    await ui.clickSend();
    expect(rec.btw).toEqual([{ question: 'what changed in this file?' }]);
    expect(rec.sends).toEqual([]);
    expect(rec.drafts).toEqual(['']);
  });

  test('a /btw draft carries the composer attachments to the panel', async () => {
    const att: Attachment = { id: 'a1', name: 'shot.png', preview: 'blob:x', type: 'image/png' };
    attachmentsForClick = [att];
    const rec = makeRecorded({ inputValue: '/btw:see this' });
    const ui = await mount(rec.deps);
    await ui.clickSend();
    expect(rec.btw).toEqual([{ question: 'see this', attachments: [att] }]);
  });

  test('/btw is NOT refused by the TUI-only guard that also lists it', async () => {
    const rec = makeRecorded({ inputValue: '/btw' });
    await (await mount(rec.deps)).clickSend();
    // The panel got the bare invocation (open history), and no notice row was
    // appended — the ordering rule the module documents.
    expect(rec.btw).toEqual([{ question: '' }]);
    expect(rec.deps.localMessagesRef.current).toEqual([]);
  });

  test('an ordinary prompt passes through to executeSend and clears the draft', async () => {
    const rec = makeRecorded({ inputValue: '  do the thing  ' });
    await (await mount(rec.deps)).clickSend();
    expect(rec.sends).toEqual([{ text: 'do the thing', attachments: [], scope: 'sess-1' }]);
    expect(rec.btw).toEqual([]);
    expect(rec.drafts).toEqual(['']);
  });

  test('a TUI-only command is refused locally, keeps the draft, and sends nothing', async () => {
    const rec = makeRecorded({ inputValue: '/hotkeys' });
    await (await mount(rec.deps)).clickSend();
    expect(rec.sends).toEqual([]);
    expect(rec.btw).toEqual([]);
    expect(rec.drafts).toEqual([]);
    const rows = rec.deps.localMessagesRef.current;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.role).toBe('ai');
    expect(rows[0]?.notice).toContain('/hotkeys');
  });

  test('a submit while streaming queues the follow-up with the composer snapshot', async () => {
    const composerPick = { provider: 'anthropic', modelId: 'claude', thinkingLevel: 'high' };
    const rec = makeRecorded({
      inputValue: 'next please',
      isGenerating: true,
      composerModelRef: { current: composerPick },
      accessModeRef: { current: 'yolo' },
    });
    await (await mount(rec.deps)).clickSend();
    expect(rec.sends).toEqual([]);
    expect(rec.drafts).toEqual(['']);
    expect(rec.queued).toHaveLength(1);
    expect(rec.queued[0]?.text).toBe('next please');
    expect(rec.queued[0]?.model).toEqual({ ...composerPick, accessMode: 'yolo' });
  });

  // The bug: a run this page did not start (a second tab, a scheduled task, the
  // goal driver's continuation, a reload that never re-attached) leaves
  // `isGenerating` false while the server streams. Reading only the local flag
  // sent a PLAIN prompt into that run, omp refused it mid-turn, and the message
  // was lost. The chat-level `chatRunning` is what the queue decision must use.
  test('a submit during a run this page did NOT start is queued, not sent', async () => {
    const rec = makeRecorded({
      inputValue: 'do not lose me',
      isGenerating: false,
      chatRunning: true,
    });
    await (await mount(rec.deps)).clickSend();
    expect(rec.sends).toEqual([]);
    expect(rec.drafts).toEqual(['']);
    expect(rec.queued).toHaveLength(1);
    expect(rec.queued[0]?.text).toBe('do not lose me');
  });

  test('a mid-turn refusal from a plain send falls back to the queue', async () => {
    // The local flag said idle, the chat flag said idle, so the send went out —
    // and omp refused it (`agent_busy`). Nothing was delivered, so it must be
    // queued rather than dropped.
    const sends: Array<{ text: string; attachments: Attachment[] }> = [];
    const rec = makeRecorded({
      inputValue: 'raced the run',
      isGenerating: false,
      chatRunning: false,
      executeSend: async (text, attachments) => {
        sends.push({ text, attachments });
        return { ok: false, busy: true, error: 'agent busy' };
      },
    });
    await (await mount(rec.deps)).clickSend();
    expect(sends).toEqual([{ text: 'raced the run', attachments: [] }]);
    expect(rec.queued).toHaveLength(1);
    expect(rec.queued[0]?.text).toBe('raced the run');
  });

  // The popup offers a plugin's `commandPaletteAction` as a `/command` row, so
  // the send path must answer that token locally — a forwarded one would reach
  // the model as literal text. `hotkeys` is deliberate (a TUI-only name): it
  // pins that the plugin branch runs BEFORE the guard, otherwise the row the
  // popup just offered would be refused with a notice.
  test('a plugin command runs the plugin, sends nothing, and clears the draft', async () => {
    const runs: Array<{ args: string; sessionId: string | null; workspacePath: string | null }> = [];
    registerListSlot('plug', 'commandPaletteAction', {
      id: 'hotkeys-row',
      command: 'hotkeys',
      description: 'Show the hotkeys',
      run: (context: CommandActionContext) => {
        runs.push({ args: context.args, sessionId: context.sessionId, workspacePath: context.workspacePath });
      },
    });
    setPluginContext('sess-1', '/repo');
    const rec = makeRecorded({ inputValue: '/hotkeys global' });

    await (await mount(rec.deps)).clickSend();

    expect(runs).toEqual([{ args: 'global', sessionId: 'sess-1', workspacePath: '/repo' }]);
    expect(rec.sends).toEqual([]);
    expect(rec.drafts).toEqual(['']);
    expect(rec.deps.localMessagesRef.current).toEqual([]);
  });

  test('a slash command no plugin registered still follows the normal send path', async () => {
    registerListSlot('plug', 'commandPaletteAction', {
      id: 'deploy-row',
      command: 'deploy',
      description: 'Deploy the workspace',
      run: () => {},
    });
    // `fix` is neither registered here nor in the TUI-only table, so nothing
    // intercepts it: it must reach the send path as an ordinary prompt.
    const rec = makeRecorded({ inputValue: '/fix the failing test' });

    await (await mount(rec.deps)).clickSend();

    expect(rec.sends).toEqual([{ text: '/fix the failing test', attachments: [], scope: 'sess-1' }]);
  });
});
