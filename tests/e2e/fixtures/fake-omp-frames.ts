/**
 * @license
 * SPDX-License-Identifier: MIT
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
  /**
   * Append one JSONL entry to the session file, the way omp persists a run.
   *
   * Optional because most specs assert only what the STREAM renders. A spec
   * that reloads the page mid-turn needs the transcript, and needs the entries
   * omp writes for a tool call in flight — the assistant message carrying the
   * `toolCall` block and the `tool_execution_start` custom entry — or the
   * reloaded timeline has nothing to render.
   */
  persist?: (entry: unknown) => void;
}

/**
 * An assistant message in the shape omp emits on the wire.
 *
 * `id` is load-bearing, not decoration: Kabmo's mapper keys a timeline row
 * by the message's OWN id and falls back to `msg-<timestamp>-ai` when it is
 * absent. A fixture that omitted it therefore let two frames created in the same
 * millisecond derive the SAME id, and the timeline rendered the turn twice —
 * measured as an intermittent duplicate row on ~1 run in 30. Real omp sends the
 * id, so the fixture must too.
 */
export function assistantMessage(text: string, stopReason = 'end_turn', id?: string) {
  return {
    ...(id ? { id } : {}),
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

export function createFrameWriters({ write, persist }: FrameWriterDeps) {
  /** Stream one assistant message as the frames omp would emit for it. */
  async function streamAnswer(messageId: string, text: string) {
    const full = assistantMessage(text, 'end_turn', messageId);
    // `message_start` carries the FULL message, and every `message_update`
    // carries it accumulated again — the `"full"` projection `configureChild`
    // requests. The client folds each frame as-is.
    write({ type: 'message_start', messageId, message: full });

    const pieces = text.match(/[\s\S]{1,12}/g) ?? [text];
    for (const [index, piece] of pieces.entries()) {
      const accumulated = pieces.slice(0, index + 1).join('');
      write({
        type: 'message_update',
        messageId,
        message: { ...full, content: [{ type: 'text', text: accumulated }] },
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: piece, partial: full },
      });
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
   * `id`/`name` and re-sends the whole accumulated message on every delta (the
   * `"full"` projection), so the card is named from the first fragment; the
   * fixture emits that shape. A fixture that skipped the message would leave the
   * timeline with nothing to render and any spec's assertion vacuous.
   */
  async function streamToolCall(toolName: string, command?: string) {
    const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
    // A caller may hand over the command so the activity phrase is long enough
    // to overflow a narrow composer row — the only way a spec can observe the
    // indicator's truncation contract.
    const args = { command: command ?? `echo ${toolName}` };
    const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const block = { type: 'toolCall', id: callId, name: toolName, arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse', messageId), content: [block] };
    const json = JSON.stringify(args);

    // The seed carries the block with its id/name; the deltas re-send it
    // accumulated, so the name is readable the moment the call starts.
    write({ type: 'message_start', messageId, message });
    write({
      type: 'message_update',
      messageId,
      message,
      assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, partial: message },
    });
    for (const piece of json.match(/[\s\S]{1,6}/g) ?? [json]) {
      write({
        type: 'message_update',
        messageId,
        message,
        assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 0, delta: piece, partial: message },
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
      message,
      assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: block, partial: message },
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

  /**
   * A BLOCKING `wait`, in the shape omp actually sends.
   *
   * Two things make this different from `streamToolCall`, and both are what the
   * panel exists for:
   *   - the turn stays open for `seconds`, so the card is observed while it is
   *     still RUNNING rather than only after it settles;
   *   - `tool_execution_update` carries a full `CoordinationDetails` snapshot
   *     every 500 ms (`PROGRESS_INTERVAL_MS` in omp's wait tool), with the job's
   *     live `durationMs` — the only progress such a call reports. omp's real
   *     `partialResult` nests `details` beside `content`, and the frame carries
   *     no duration of its own.
   */
  async function streamWait(seconds: number) {
    const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
    const jobId = 'bg_1';
    const label = 'bun run probe.ts';
    const args = { i: 'Waiting for the probe job' };
    const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const block = { type: 'toolCall', id: callId, name: 'wait', arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse', messageId), content: [block] };

    write({ type: 'message_start', messageId, message });
    write({
      type: 'message_update',
      messageId,
      message,
      assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: block, partial: message },
    });
    write({ type: 'message_end', messageId, message });
    write({ type: 'turn_end', message, toolResults: [] });

    // The transcript a reload reads: omp writes the assistant turn as it
    // streams, then one `tool_execution_start` entry when the call opens — and
    // NOTHING more until the result, which is exactly the window a reload
    // lands in.
    persist?.({ type: 'message', id: messageId, parentId: null, timestamp: new Date().toISOString(), message });
    write({ type: 'tool_execution_start', toolCallId: callId, toolName: 'wait', args });
    persist?.({
      type: 'custom',
      customType: 'tool_execution_start',
      timestamp: new Date().toISOString(),
      data: { toolCallId: callId, toolName: 'wait', startedAt: new Date().toISOString() },
    });

    const startedAt = Date.now();
    const totalMs = seconds * 1000;
    // The first snapshot lands immediately (omp emits one before its interval
    // loop), then one per 500 ms, exactly like the real tool.
    for (;;) {
      const elapsed = Date.now() - startedAt;
      const done = elapsed >= totalMs;
      write({
        type: 'tool_execution_update',
        toolCallId: callId,
        toolName: 'wait',
        args,
        partialResult: {
          content: [{ type: 'text', text: '' }],
          details: {
            op: 'wait',
            meta: { source: { type: 'report', value: 'background jobs snapshot' } },
            jobs: [{
              id: jobId,
              type: 'bash',
              status: done ? 'completed' : 'running',
              label,
              durationMs: Math.min(elapsed, totalMs),
              ...(done ? { exitCode: 0 } : {}),
            }],
          },
        },
      });
      if (done) break;
      await sleep(500);
    }

    const details = {
      op: 'wait',
      meta: { source: { type: 'report', value: 'background jobs snapshot' } },
      jobs: [{ id: jobId, type: 'bash', status: 'completed', label, durationMs: totalMs, exitCode: 0 }],
    };
    write({
      type: 'tool_execution_end',
      toolCallId: callId,
      toolName: 'wait',
      result: {
        content: [{ type: 'text', text: '## Completed (1)\n\n### bg_1 [bash] — completed\nLabel: bun run probe.ts' }],
        details,
      },
      isError: false,
    });
  }

  /**
   * A `wait` whose 30-minute cap FIRED.
   *
   * omp answers it `{op:'wait', jobs:[]}` — the same shape a service wake
   * returns — plus the sentence that is the only thing telling them apart. The
   * card must report a limit, not "no jobs".
   */
  async function streamWaitLimit() {
    const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
    const args = { i: 'Waiting for the probe job' };
    const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const block = { type: 'toolCall', id: callId, name: 'wait', arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse', messageId), content: [block] };

    write({ type: 'message_start', messageId, message });
    write({ type: 'message_update', messageId, message, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: block, partial: message } });
    write({ type: 'message_end', messageId, message });
    write({ type: 'turn_end', message, toolResults: [] });
    write({ type: 'tool_execution_start', toolCallId: callId, toolName: 'wait', args });
    write({
      type: 'tool_execution_end',
      toolCallId: callId,
      toolName: 'wait',
      result: {
        content: [{ type: 'text', text: 'Wait limit reached; background work may still be running. Read proc:// for status.' }],
        details: { op: 'wait', jobs: [] },
      },
      isError: false,
    });
  }

  /**
   * An `edit` call whose result carries a real patch, so the card draws the
   * diff surface the timeline uses for a file change.
   *
   * The patch is omp's EXCERPT dialect (` 41|text`, `-43|text`, `+43|text`) —
   * the shape `details.diff` actually holds — because that is what the card
   * converts before handing the pair to the merge view. A spec that sent a
   * hand-built unified diff would exercise a dialect omp never produces.
   *
   * Every row is a CHANGE, and that is not cosmetic: the card renders with
   * `contentMode: 'diff'`, which collapses unchanged stretches into one marker.
   * A patch of mostly context therefore collapses to a few rows and fits the
   * card's 288px ceiling, so a spec built on one measures a range of ZERO and
   * proves nothing about the scroller (measured: `scrollHeight - clientHeight`
   * was 0 for an 80-row patch of context lines).
   */
  async function streamEditCall(pairs: number) {
    const callId = `call-${crypto.randomUUID().slice(0, 8)}`;
    const messageId = `msg-${crypto.randomUUID().slice(0, 8)}`;
    const path = 'src/probe.ts';
    const args = { path, old_string: 'const before = 1;', new_string: 'const after = 2;' };
    const block = { type: 'toolCall', id: callId, name: 'edit', arguments: args, partialArgs: JSON.stringify(args), streamIndex: 0 };
    const message = { ...assistantMessage('', 'toolUse', messageId), content: [block] };

    write({ type: 'message_start', messageId, message });
    write({ type: 'message_update', messageId, message, assistantMessageEvent: { type: 'toolcall_end', contentIndex: 0, toolCall: block, partial: message } });
    write({ type: 'message_end', messageId, message });
    write({ type: 'turn_end', message, toolResults: [] });

    const rows: string[] = [];
    for (let line = 1; line <= pairs; line += 1) {
      rows.push(`-${line}|const before${line} = ${line};`);
      rows.push(`+${line}|const after${line} = ${line};`);
    }

    write({ type: 'tool_execution_start', toolCallId: callId, toolName: 'edit', args });
    await sleep(20);
    write({
      type: 'tool_execution_end',
      toolCallId: callId,
      toolName: 'edit',
      result: {
        content: [{ type: 'text', text: `[${path}]\n1:const after1 = 1;` }],
        details: { path, diff: rows.join('\n') },
      },
      isError: false,
    });
  }

  return { streamAnswer, streamToolCall, streamWait, streamWaitLimit, streamEditCall };
}

export { sleep };
