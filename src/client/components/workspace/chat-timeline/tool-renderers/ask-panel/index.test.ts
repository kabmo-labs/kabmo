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
const GROUPED: ExtensionUiDialogRequest = {
  type: 'extension_ui_request', id: 'ui-grouped', method: 'ask', title: '', questions: QUESTIONS,
};

let container: HTMLElement;
beforeEach(() => { resetListSlots(); installDomGlobals(new Window()); container = document.createElement('div'); document.body.appendChild(container); });
afterEach(() => { render(null, container); container.remove(); resetListSlots(); restoreDomGlobals(); });
afterAll(() => restoreDomGlobals());

/** The REAL chain: omp frame → callback gate → pending queue → split → card. */
function mountFromFrame(frame: IncomingExtensionUiRequest): ExtensionUiDialogRequest[] {
  const queue: ExtensionUiDialogRequest[] = [];
  const deps = {
    setGenerating: () => {}, setGeneratingVerb: () => {}, activityRef: { current: '' }, scrollToBottom: () => {},
    adoptedSessionIdRef: { current: null }, sessionIdRef: { current: 'sess' },
    metaRefreshedRef: { current: null }, refreshSessionMeta: () => {},
    setLocalMessages: () => {}, aiPlaceholderIdRef: { current: null },
    optimisticUserIdRef: { current: null }, pendingUserDisplaysRef: { current: [] },
    persistMessages: () => {}, abortControllerRef: { current: null }, appSettings: {},
    enqueueExtensionDialog: (request) => queue.push(request),
    withdrawExtensionDialog: (targetId) => { const i = queue.findIndex((r) => r.id === targetId); if (i >= 0) queue.splice(i, 1); },
    reloadMessages: () => {},
    needsReloadRef: { current: false },
  } satisfies OmpAgentCallbacksDeps;
  createOmpAgentCallbacks(deps).onExtensionUiRequest?.(frame);

  const split = splitAskFrames([MESSAGE], queue, true);
  const handle: AskFramesHandle = { framesByTool: split.framesByTool, orphanAsks: [], respond: () => {} };
  act(() => { render(h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool: ASK_TOOL })), container); });
  return queue;
}

/** Mount the card with an explicit frame queue and tool, keeping it mounted. */
function paint(queue: ExtensionUiDialogRequest[], tool: ToolCallData = ASK_TOOL): void {
  const split = splitAskFrames([MESSAGE], queue, true);
  const handle: AskFramesHandle = { framesByTool: split.framesByTool, orphanAsks: [], respond: () => {} };
  act(() => { render(h(AskFramesContext.Provider, { value: handle }, h(AskPanel, { tool })), container); });
}

function button(text: string): HTMLElement {
  const found = [...container.querySelectorAll('button')].find((node) => node.textContent === text);
  if (!found) throw new Error(`no button labelled "${text}" in ${container.innerHTML}`);
  return found as HTMLElement;
}

const ANSWERED_TOOL: ToolCallData = {
  ...ASK_TOOL,
  status: 'success',
  details: { results: [
    { id: 'q1', selectedOptions: ['red', 'green'] },
    { id: 'q2', selectedOptions: ['m'], customInput: 'a typed answer' },
  ] },
};

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

  test('submitting does not flip the card back to unanswered while omp acts', () => {
    // The reported symptom: answering the grouped dialog made the card read
    // "Waiting for the previous answer…" on every question, because the frame
    // left the pending queue the instant the response was sent and omp writes
    // no tool result until the tool call finishes.
    paint([GROUPED]);
    act(() => button('red').click());
    act(() => button('m').click());
    act(() => button('Submit answers').click());
    // omp has not echoed the result yet — only the client's own hold remains.
    paint([]);

    const html = container.innerHTML;
    expect(html).not.toContain('Waiting for the previous answer');
    expect(html).toContain('answered');
    expect(html).toContain('Pick colors');
    expect(html).toContain('Pick a size');
  });

  test('answers render as stacked rows, never as a sideways chip strip', () => {
    // The other reported symptom: the grouped card's answer was a `flex-wrap`
    // chip strip, so a label plus typed text ran sideways as one sentence.
    paint([], ANSWERED_TOOL);
    const rows = [...container.querySelectorAll('[data-answer-row]')].map((node) => node.textContent?.trim());
    expect(rows).toEqual(['red', 'green', 'm', 'a typed answer']);
    expect(container.innerHTML).not.toContain('flex-wrap items-center gap-1.5');
  });

  test("omp's option description is VISIBLE text, not a hover tooltip", () => {
    // The reported symptom: the grouped card drew each option as a chip whose
    // only description was a `title` attribute, so the tradeoff omp writes for
    // every choice ("short labels, tradeoffs in `description`" is its own ask
    // prompt) was invisible until hovered — and invisible entirely on a phone.
    // Both ask shapes share `OptionRow`, so this is the per-question path's
    // behaviour too; it is pinned once, on the card that drifted.
    const DESCRIBED: ExtensionUiDialogRequest = {
      ...GROUPED,
      questions: [
        {
          id: 'q1',
          question: 'Pick colors',
          options: [
            { label: 'red', description: 'the warm one' },
            { label: 'green', description: 'the cool one' },
          ],
        },
      ],
    };
    paint([DESCRIBED]);

    expect(container.textContent).toContain('the warm one');
    expect(container.textContent).toContain('the cool one');
    expect(container.querySelector('[title="the warm one"]')).toBeNull();
  });
});
