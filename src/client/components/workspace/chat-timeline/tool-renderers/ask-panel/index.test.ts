import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AskPanel } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel';
import { AskFramesContext, splitAskFrames, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames';
import { createOmpAgentCallbacks, type OmpAgentCallbacksDeps } from '@/shared/lib/chat/timeline/omp-callbacks';
import { resetListSlots } from '@/client/lib/plugins/list-slots';
import type { ChatMessageData, ToolCallData } from '@/shared/types';
import type { ExtensionUiDialogRequest, IncomingExtensionUiRequest } from '@/shared/types/omp/agent';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const QUESTIONS = [
  { id: 'q1', question: 'Pick colors', options: [{ label: 'red' }, { label: 'green' }], multi: true },
  { id: 'q2', question: 'Pick a size', options: [{ label: 's' }, { label: 'm' }] },
];
const ASK_TOOL: ToolCallData = {
  id: 'call-ask', type: 'other', title: 'ask', name: 'ask', status: 'running',
  input: { questions: QUESTIONS },
};
const MESSAGE = { id: 'm1', role: 'ai', content: '', toolCalls: [ASK_TOOL] } as unknown as ChatMessageData;
const GROUPED = {
  type: 'extension_ui_request', id: 'ui-grouped', method: 'ask', title: '', questions: QUESTIONS,
} as unknown as IncomingExtensionUiRequest;

let container: HTMLElement;
beforeEach(() => { resetListSlots(); installDomGlobals(new Window()); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { render(null, container); container.remove(); resetListSlots(); restoreDomGlobals(); });
afterAll(() => restoreDomGlobals());

/** The REAL chain: omp frame → callback gate → pending queue → split → card. */
function mountFromFrame(frame: IncomingExtensionUiRequest): ExtensionUiDialogRequest[] {
  const queue: ExtensionUiDialogRequest[] = [];
  const deps = {
    setGenerating: () => {}, setGeneratingVerb: () => {}, scrollToBottom: () => {},
    adoptedSessionIdRef: { current: null }, sessionIdRef: { current: 'sess' },
    metaRefreshedRef: { current: null }, refreshSessionMeta: () => {},
    setLocalMessages: () => {}, aiPlaceholderIdRef: { current: null },
    optimisticUserIdRef: { current: null }, pendingUserDisplaysRef: { current: [] },
    persistMessages: () => {}, abortControllerRef: { current: null }, appSettings: {},
    enqueueExtensionDialog: (request) => queue.push(request),
    withdrawExtensionDialog: (targetId) => { const i = queue.findIndex((r) => r.id === targetId); if (i >= 0) queue.splice(i, 1); },
  } satisfies OmpAgentCallbacksDeps;
  createOmpAgentCallbacks(deps).onExtensionUiRequest?.(frame);

  const split = splitAskFrames([MESSAGE], queue, true);
  const handle: AskFramesHandle = { framesByTool: split.framesByTool, respond: () => {} };
  act(() => { render(h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: ASK_TOOL })), container); });
  return queue;
}

describe('grouped ask frame end to end', () => {
  test('a real omp ask frame reaches the card and is answerable', () => {
    const queue = mountFromFrame(GROUPED);
    expect(queue.map((r) => r.method)).toEqual(['ask']);
    const html = container.innerHTML;
    expect(html).not.toContain('Waiting for the previous answer');
    expect(html).toContain('Submit answers');
    expect(html).toContain('Pick colors');
    expect(html).toContain('Pick a size');
  });
});
