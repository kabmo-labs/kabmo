/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The ask/approval routing split, and the one thing it must never do: paint a
 * dialog as a modal and then take it back.
 *
 * On session open the pending dialogs are replayed from the agent-state probe
 * (which answers out of the wrapper's local flags) long before the session
 * JSONL lands, so every replayed frame looks unowned while `messages` is still
 * empty — while the ask card that owns it is one fetch away. Deciding "no card
 * owns this" during that window flashed the ask modal on every switch to a
 * session parked on a question. These pin the hold, and that it never turns
 * into a silently dropped question.
 */

import { describe, expect, test } from 'bun:test';

import type { ChatMessageData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { splitAskFrames } from '@/client/hooks/chat/timeline/ask-frames';

/** An assistant turn whose `ask` tool call asked `questions`, as the JSONL and
 *  the live stream both deliver it. */
function askHistory(questions: string[]): ChatMessageData[] {
  return [
    {
      id: 'msg-ask',
      role: 'ai',
      content: '',
      toolCalls: [
        {
          id: 'call_ask',
          type: 'ask',
          name: 'ask',
          title: 'ask',
          input: { questions: questions.map((question) => ({ question, options: [{ label: 'A' }, { label: 'B' }] })) },
        },
      ],
    },
  ];
}

function selectFrame(id: string, title: string): ExtensionUiDialogRequest {
  return { type: 'extension_ui_request', id, method: 'select', title, options: ['A (Recommended)', 'B', 'Other (type your own)'] };
}

function confirmFrame(id: string, title: string): ExtensionUiDialogRequest {
  return { type: 'extension_ui_request', id, method: 'confirm', title };
}

describe('splitAskFrames', () => {
  test('a question dialog is claimed by the ask card, not handed to the modal', () => {
    const frame = selectFrame('f1', 'Which language?');
    const split = splitAskFrames(askHistory(['Which language?']), [frame], true);

    expect(split.framesByTool.get('call_ask')?.[0]?.map((held) => held.id)).toEqual(['f1']);
    expect(split.modalRequest).toBeNull();
  });

  test('the modal is held while the session history is still loading', () => {
    const question = selectFrame('f1', 'Which language?');
    const gate = confirmFrame('g1', 'Run bash?');

    // The regression: the frame has been replayed, its tool call has not.
    expect(splitAskFrames([], [question], false)).toEqual({ framesByTool: new Map(), orphanAsks: [], modalRequest: null });
    // The hold is uniform — a gate cannot be told from an ask before history
    // either, and it is re-decided the moment the history settles.
    expect(splitAskFrames([], [gate], false).modalRequest).toBeNull();
  });

  test('once the history has settled an unclaimed dialog stays answerable', () => {
    const frame = selectFrame('f1', 'Which language?');
    expect(splitAskFrames([], [frame], true).modalRequest).toBe(frame);
  });

  test('an approval gate keeps the modal beside a claimed question', () => {
    const question = selectFrame('f1', 'Which language?');
    const gate = confirmFrame('g1', 'Run bash?');
    const split = splitAskFrames(askHistory(['Which language?']), [question, gate], true);

    expect(split.framesByTool.get('call_ask')?.[0]?.map((held) => held.id)).toEqual(['f1']);
    expect(split.modalRequest).toBe(gate);
  });

  test('a dead ask cannot claim the dialog of the retry that reused its question', () => {
    // The reported shape: omp rejects the first `ask` (a missing question id),
    // the model re-asks the SAME question, and the live dialog used to be
    // claimed by the dead call — whose card renders no control because it is
    // settled. The retry then read "Waiting for the previous answer…" over a
    // frame nothing could answer, and the agent stayed blocked.
    const [dead] = askHistory(['Which language?']);
    dead.toolCalls![0].id = 'call_dead';
    dead.toolCalls![0].status = 'error';
    dead.toolCalls![0].output = 'Validation failed for tool "ask": questions/0/id must be a string';
    const [live] = askHistory(['Which language?']);
    live.toolCalls![0].id = 'call_live';

    const frame = selectFrame('f1', 'Which language?');
    const split = splitAskFrames([dead, live], [frame], true);

    expect(split.framesByTool.get('call_dead')).toBeUndefined();
    expect(split.framesByTool.get('call_live')?.[0]?.map((held) => held.id)).toEqual(['f1']);
    expect(split.modalRequest).toBeNull();
  });

  test('a still-blocking call read back from the JSONL keeps its dialog', () => {
    // A reloaded session reports the parked call as `success` (omp writes no
    // result until the question is answered), so it must stay a candidate.
    const [reloaded] = askHistory(['Which language?']);
    reloaded.toolCalls![0].status = 'success';

    const frame = selectFrame('f1', 'Which language?');
    const split = splitAskFrames([reloaded], [frame], true);

    expect(split.framesByTool.get('call_ask')?.[0]?.map((held) => held.id)).toEqual(['f1']);
  });

  test('an already answered ask cannot claim a later dialog', () => {
    const [answered] = askHistory(['Which language?']);
    answered.toolCalls![0].details = { selectedOptions: ['Python'] };

    const frame = selectFrame('f1', 'Which language?');
    const split = splitAskFrames([answered], [frame], true);

    expect(split.framesByTool.get('call_ask')).toBeUndefined();
    expect(split.modalRequest).toBe(frame);
  });

  test('a retry whose questions never parsed falls back to the modal', () => {
    // The safety net the module note describes: no card can claim the frame,
    // so it stays answerable instead of vanishing.
    const [dead] = askHistory(['Which language?']);
    dead.toolCalls![0].id = 'call_dead';
    dead.toolCalls![0].status = 'error';
    const truncated: ChatMessageData = {
      id: 'msg-trunc',
      role: 'ai',
      content: '',
      toolCalls: [{ id: 'call_trunc', type: 'ask', name: 'ask', title: 'ask', status: 'running', input: { questions: 'truncated' } }],
    };

    const frame = selectFrame('f1', 'Which language?');
    const split = splitAskFrames([dead, truncated], [frame], true);

    expect(split.framesByTool.size).toBe(0);
    expect(split.modalRequest).toBe(frame);
  });
});
