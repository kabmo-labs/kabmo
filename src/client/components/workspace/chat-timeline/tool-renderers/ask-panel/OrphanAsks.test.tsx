/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The reported defect: an `ask` dialog that no tool card owns was handed to the
 * MODAL, which has no `ask` body — the panel came up empty with a single
 * "Submit Response" button, and that button sent a bare `{ value }` omp rejects
 * ("Ask dialog response must carry N answers"), so the agent stayed parked on a
 * question the user could not even read.
 *
 * These pin the routing end to end: an ask frame is never `modalRequest`, and
 * with no card to claim it the timeline draws it inline instead.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { AskFramesContext, splitAskFrames, type AskFramesHandle } from '@/client/hooks/chat/timeline/ask-frames';
import { OrphanAsks } from '@/client/components/workspace/chat-timeline/tool-renderers/ask-panel/OrphanAsks';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { installDomGlobals, restoreDomGlobals } from '@/test-support/pristine-globals';

const QUESTIONS = [
  { id: 'q1', question: 'Pick colors', options: [{ label: 'red' }, { label: 'green' }], multi: true },
  { id: 'q2', question: 'Pick a size', options: [{ label: 's' }, { label: 'm' }] },
];

const ORPHAN: ExtensionUiDialogRequest = {
  type: 'extension_ui_request',
  id: 'ui-orphan',
  method: 'ask',
  title: '',
  questions: QUESTIONS,
};

let container: HTMLElement;

beforeEach(() => {
  installDomGlobals(new Window());
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  restoreDomGlobals();
});

afterAll(() => restoreDomGlobals());

/** The split the timeline computes, with nothing on the timeline to claim it. */
function splitWithoutCards(frames: ExtensionUiDialogRequest[]) {
  return splitAskFrames([], frames, true);
}

describe('an ask dialog with no tool card', () => {
  test('is never handed to the modal', () => {
    const split = splitWithoutCards([ORPHAN]);
    expect(split.modalRequest).toBeNull();
    expect(split.orphanAsks).toEqual([ORPHAN]);
  });

  test('renders inline with every question and its own submit', () => {
    const split = splitWithoutCards([ORPHAN]);
    const handle: AskFramesHandle = { framesByTool: split.framesByTool, orphanAsks: split.orphanAsks, respond: () => {} };

    act(() => {
      render(h(AskFramesContext.Provider, { value: handle }, h(OrphanAsks, {})), container);
    });

    // The question text — the thing the empty modal did not have at all.
    expect(container.textContent).toContain('Pick colors');
    expect(container.textContent).toContain('Pick a size');
    // Its answers are chosen here, and submitted by the card itself.
    expect(container.textContent).toContain('Submit answers');
    // No dialog role anywhere: this is a timeline row, not an overlay.
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  test('answering sends one answers entry per question', () => {
    const sent: unknown[] = [];
    const split = splitWithoutCards([ORPHAN]);
    const handle: AskFramesHandle = {
      framesByTool: split.framesByTool,
      orphanAsks: split.orphanAsks,
      respond: (_request, response) => sent.push(response),
    };

    act(() => {
      render(h(AskFramesContext.Provider, { value: handle }, h(OrphanAsks, {})), container);
    });

    const button = (text: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.includes(text)) as HTMLElement | undefined;

    act(() => { button('red')?.click(); });
    act(() => { button('s')?.click(); });
    act(() => { button('Submit answers')?.click(); });

    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      answers: [
        { id: 'q1', selectedOptions: ['red'] },
        { id: 'q2', selectedOptions: ['s'] },
      ],
    });
  });

  test('the orphan row is held until the session history has loaded', () => {
    // Same window as the modal hold: on session open a replayed frame looks
    // cardless until the JSONL lands, so drawing it now would paint the
    // question at the tail and then move it onto its card.
    expect(splitAskFrames([], [ORPHAN], false).orphanAsks).toEqual([]);
    expect(splitAskFrames([], [ORPHAN], true).orphanAsks).toEqual([ORPHAN]);
  });

  test('an approval gate still keeps its modal', () => {
    const gate: ExtensionUiDialogRequest = { type: 'extension_ui_request', id: 'g1', method: 'confirm', title: 'Run bash?' };
    const split = splitWithoutCards([gate]);
    expect(split.modalRequest).toBe(gate);
    expect(split.orphanAsks).toEqual([]);
  });
});
