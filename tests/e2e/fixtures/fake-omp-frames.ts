/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The frames a scripted `omp` child writes for one turn, split out of
 * `fake-omp.ts` (which is at the repo's per-file ceiling).
 *
 * Every function here is a pure emitter over an injected `write` — the child's
 * own stdout and its delta-mode flag are the only state involved — so the
 * shapes stay readable as one list rather than being interleaved with the
 * child's command loop.
 *
 * `assistantMessage` deliberately builds a REAL omp `AgentMessage`: the
 * timeline's mappers read `role`, `content` blocks, `usage` and `stopReason`,
 * and a fixture that omitted any of them would exercise a shape the product
 * never receives.
 */

export interface FrameWriterDeps {
  /** Write one frame to the child's stdout. */
  write: (frame: unknown) => void;
  /** Whether the chamber has requested delta-mode `message_update` frames. */
  isDeltaMode: () => boolean;
}

/** An assistant message in the shape omp emits on the wire. */
export function assistantMessage(text: string, stopReason = 'end_turn') {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    api: 'openai-completions',
    provider: 'fake',
    model: 'fake-model',
    usage: { input: 100, output: text.length, cacheRead: 0, cacheWrite: 0, totalTokens: 100 + text.length, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    stopReason,
    timestamp: Date.now(),
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFrameWriters({ write, isDeltaMode }: FrameWriterDeps) {
  /** Stream one assistant message as the frames omp would emit for it. */
  async function streamAnswer(messageId: string, text: string) {
    const full = assistantMessage(text);
    // `message_start` carries the FULL message — the seed the accumulator keeps.
    write({ type: 'message_start', messageId, message: full });

    const pieces = text.match(/[\s\S]{1,12}/g) ?? [text];
    for (const [index, piece] of pieces.entries()) {
      if (isDeltaMode()) {
        // Delta mode: `message` shrinks to `{role}` and the fragment rides
        // `assistantMessageEvent`. The client rebuilds the accumulated shape.
        write({
          type: 'message_update',
          messageId,
          message: { role: 'assistant' },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: piece, partial: full },
        });
      } else {
        // A build that ignores the filter re-sends the whole accumulated message.
        const accumulated = pieces.slice(0, index + 1).join('');
        write({
          type: 'message_update',
          messageId,
          message: { ...full, content: [{ type: 'text', text: accumulated }] },
          assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: piece, partial: full },
        });
      }
      await sleep(15);
    }

    // The authority: the finished message, full either way.
    write({ type: 'message_end', messageId, message: full });
    write({ type: 'turn_end', message: full, toolResults: [] });
    return full;
  }

  /**
   * A tool call, as the frames the timeline folds into one card.
   *
   * The assistant MESSAGE is what makes a card exist: `tool_execution_*` frames
   * only carry the result, and the timeline draws a card from the message's
   * `toolCall` block. Real omp seeds that block on `message_start` with its own
   * `id`/`name`, streams the arguments as `toolcall_delta` (the delta frames
   * carry ONLY `{contentIndex, delta}` — no `partial`, no `name`), and repeats
   * the whole block on `toolcall_end`. That shape is what
   * `delta-accumulator.ts` rebuilds, so the fixture emits it — a fixture that
   * skipped the message would leave the timeline with nothing to render and any
   * spec's assertion vacuous.
   */
  async function streamToolCall(toolName: string) {
    const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
    const args = { command: `echo ${toolName}` };
    const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const block = { type: 'toolCall', id: callId, name: toolName, arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse'), content: [block] };
    const json = JSON.stringify(args);

    // The seed carries the finished block; the deltas carry only their fragment.
    write({ type: 'message_start', messageId, message });
    write({
      type: 'message_update',
      messageId,
      message: isDeltaMode() ? { role: 'assistant' } : message,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, ...(isDeltaMode() ? {} : { partial: message }) },
    });
    for (const piece of json.match(/[\s\S]{1,6}/g) ?? [json]) {
      write({
        type: 'message_update',
        messageId,
        message: isDeltaMode() ? { role: 'assistant' } : message,
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: piece, ...(isDeltaMode() ? {} : { partial: message }) },
      });
      // Slow on purpose: the argument stream is the window in which the card's
      // name and subtitle must already be readable. At omp's real speed the
      // whole call lands in a few milliseconds and a spec cannot observe the
      // mid-stream state at all — which is why the broken build passed a spec
      // that only checked the finished card.
      await sleep(300);
    }
    write({
      type: 'message_update',
      messageId,
      message: isDeltaMode() ? { role: 'assistant' } : message,
      assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: block, ...(isDeltaMode() ? {} : { partial: message }) },
    });
    write({ type: 'message_end', messageId, message });
    write({ type: 'turn_end', message, toolResults: [] });

    write({ type: 'tool_execution_start', toolCallId: callId, toolName, args });
    await sleep(20);
    write({ type: 'tool_execution_update', toolCallId: callId, partialResult: `${toolName} output` });
    await sleep(20);
    write({
      type: 'tool_execution_end',
      toolCallId: callId,
      toolName,
      result: { content: [{ type: 'text', text: `${toolName} output` }], isError: false },
      isError: false,
    });
  }

  return { streamAnswer, streamToolCall };
}

export { sleep };
