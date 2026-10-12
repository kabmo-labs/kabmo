/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The delta accumulator rebuilds the accumulated message omp stops sending
 * under `set_event_filter { messageUpdates: "delta" }`.
 *
 * The frame shapes here are copied from a real capture on omp 18.8.3 (see
 * `docs/omp-18.8-adoption-plan.md`, F3): `message_start` carries the whole
 * message and no `assistantMessageEvent`; each `message_update` carries only
 * `{role}` plus one fragment; `message_end` carries the whole message again.
 *
 * Two properties matter and both were bugs first:
 *   - the rebuilt message keeps the SEED's `timestamp`, so `toChatMessage`
 *     derives one row id for the whole stream instead of one per token;
 *   - a `_start` RESETS its block, because the seed already holds that block's
 *     finished text on some builds and the deltas then double it.
 */

import { describe, expect, test } from 'bun:test';

import { createDeltaAccumulator } from '@/shared/lib/chat/omp/delta-accumulator';
import { toChatMessage } from '@/shared/lib/omp/session/mapper';

const SEED = {
  type: 'message_start',
  messageId: 'msg-2',
  message: {
    role: 'assistant',
    content: [{ type: 'text', text: 'hello world' }],
    provider: 'openai',
    model: 'gpt-5',
    timestamp: 1757943900000,
  },
};

const update = (assistantMessageEvent: Record<string, unknown>) => ({
  type: 'message_update',
  messageId: 'msg-2',
  message: { role: 'assistant' },
  assistantMessageEvent,
});

/** Fold a run of frames and report the row each update would render. */
function rows(frames: Array<Record<string, unknown>>) {
  const acc = createDeltaAccumulator();
  const out: Array<{ id: string; content: string }> = [];
  for (const frame of frames) {
    const rebuilt = acc.apply(frame);
    if (rebuilt) {
      const msg = toChatMessage(rebuilt.message, true);
      if (msg) out.push({ id: msg.id, content: msg.content });
    }
    if (frame.type === 'message_end') acc.clear(frame.messageId as string);
  }
  return out;
}

describe('createDeltaAccumulator', () => {
  test('rebuilds one growing row from a seeded text stream', () => {
    const out = rows([
      SEED,
      update({ type: 'text_start', contentIndex: 0 }),
      update({ type: 'text_delta', contentIndex: 0, delta: 'hel' }),
      update({ type: 'text_delta', contentIndex: 0, delta: 'lo wo' }),
      update({ type: 'text_delta', contentIndex: 0, delta: 'rld' }),
      update({ type: 'text_end', contentIndex: 0, content: 'hello world' }),
    ]);
    // ONE row for the whole stream: the id comes from the seed's timestamp.
    expect(new Set(out.map((r) => r.id)).size).toBe(1);
    expect(out.at(-1)?.content).toBe('hello world');
    // The `_start` reset means the seeded text is not appended onto.
    expect(out.map((r) => r.content)).not.toContain('hello worldhello world');
  });

  test('accumulates a streamed tool call into the block the phase reader reads', () => {
    const acc = createDeltaAccumulator();
    acc.apply({
      type: 'message_start',
      messageId: 'm',
      message: { role: 'assistant', content: [], timestamp: 1 },
    });
    acc.apply(update({ type: 'toolcall_start', contentIndex: 0 }));
    const applied = acc.apply(update({ type: 'toolcall_delta', contentIndex: 0, delta: '{"path":' }));
    expect(applied?.message.content).toMatchObject([{ type: 'toolCall', partialArgs: '{"path":' }]);
    const end = acc.apply(update({ type: 'toolcall_end', contentIndex: 0, toolCall: { type: 'toolCall', id: 'c1', name: 'write', arguments: { path: 'x' } } }));
    expect(end?.message.content).toMatchObject([{ name: 'write', arguments: { path: 'x' } }]);
  });

  test('keys an unseeded stream to the wire id — one row, not one per fragment', () => {
    // The shape a client that attached mid-message sees: `message_start` never
    // arrived, so no frame carries the timestamp a row id is derived from. Every
    // fragment shares the wire `messageId`, and that is what must key the row —
    // measured through the real transport, a 151-fragment run attached 6.5 s in
    // rendered 151 cards before this.
    const acc = createDeltaAccumulator();
    const ids = new Set<string>();
    const contents: string[] = [];
    for (const delta of ['rea', 'son', 'ing']) {
      const rebuilt = acc.apply(update({ type: 'text_delta', contentIndex: 0, delta }));
      const msg = rebuilt ? toChatMessage(rebuilt.message, true) : null;
      if (msg) {
        ids.add(msg.id);
        contents.push(msg.content);
      }
    }
    expect([...ids]).toEqual(['msg-2']);
    expect(contents.at(-1)).toBe('reasoning');
  });

  test('stamps the adopted wire id onto the terminal message', () => {
    const acc = createDeltaAccumulator();
    acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'abc' }));
    const end = acc.apply({
      type: 'message_end',
      messageId: 'msg-2',
      message: { role: 'assistant', content: [{ type: 'text', text: 'abcdef' }], timestamp: 1757943900000 },
    });
    // Without the stamp this finalizes into `msg-<timestamp>-ai` and the run
    // ends with the partial card AND a complete one beside it.
    const msg = end ? toChatMessage(end.message, false) : null;
    expect(msg?.id).toBe('msg-2');
  });

  test('a seeded stream still keys rows by the seed timestamp', () => {
    const acc = createDeltaAccumulator();
    acc.apply(SEED);
    const rebuilt = acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'x' }));
    const msg = rebuilt ? toChatMessage(rebuilt.message, true) : null;
    expect(msg?.id).toBe('msg-1757943900000-ai');
    // A seeded message needs no adoption, so its terminal frame is untouched.
    const end = acc.apply({
      type: 'message_end',
      messageId: 'msg-2',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello world' }], timestamp: 1757943900000 },
    });
    expect(end).toBeUndefined();
  });

  test('passes an accumulated frame through untouched', () => {
    const acc = createDeltaAccumulator();
    // A build that ignores `set_event_filter` still sends the whole message on
    // every update; rebuilding it would be wrong, so the frame is returned as
    // `undefined` (caller uses it verbatim).
    const result = acc.apply({
      type: 'message_update',
      messageId: 'm',
      message: { role: 'assistant', content: [{ type: 'text', text: 'full' }] },
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'ull' },
    });
    expect(result).toBeUndefined();
  });

  test('clear() drops a message so the next run starts fresh', () => {
    const acc = createDeltaAccumulator();
    acc.apply(SEED);
    acc.apply(update({ type: 'text_start', contentIndex: 0 }));
    acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'abc' }));
    acc.clear('msg-2');
    const restarted = acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'xyz' }));
    expect(restarted?.message.content).toMatchObject([{ text: 'xyz' }]);
  });
});

/**
 * A streamed TOOL CALL is the case the seed carries more than a timestamp for,
 * and both properties below were shipped bugs on omp 18.10.0 (measured: a
 * `bash` call rendered a bare **Tool** card with no subtitle for its whole
 * stream, then snapped to `Bash — echo alpha` in one step at `toolcall_end`).
 *
 * The frames are the real ones: `message_start` seeds a block that already
 * carries omp's `id`/`name`, and `toolcall_delta` carries ONLY `{contentIndex,
 * delta}` — no `partial`, no `name`. `toolcall_end` is the first frame to
 * repeat them.
 */
describe('createDeltaAccumulator — streamed tool calls', () => {
  const TOOL_SEED = {
    type: 'message_start',
    messageId: 'm',
    message: {
      role: 'assistant',
      timestamp: 1_797_000_000_000,
      content: [
        { type: 'text', text: '\n\n' },
        { type: 'toolCall', id: 'call_abc', name: 'bash', arguments: {}, partialArgs: '{', streamIndex: 0 },
      ],
    },
  };
  const toolcall = (event: Record<string, unknown>) => ({
    type: 'message_update',
    messageId: 'm',
    message: { role: 'assistant' },
    assistantMessageEvent: event,
  });

  /** The card each fragment would draw, as the timeline derives it. */
  function cards(frames: Array<Record<string, unknown>>) {
    const acc = createDeltaAccumulator();
    const out: Array<{ id: string; name: string | undefined; args: unknown }> = [];
    for (const frame of frames) {
      const rebuilt = acc.apply(frame);
      if (!rebuilt) continue;
      const msg = toChatMessage(rebuilt.message, true);
      const call = msg?.toolCalls?.[0];
      if (call) out.push({ id: call.id, name: call.name, args: call.input });
    }
    return out;
  }

  const deltas = ['{"comm', 'and":"ec', 'ho hi"}'].map((delta) =>
    toolcall({ type: 'toolcall_delta', contentIndex: 1, delta }));

  test('keeps the seed id and name for the whole stream', () => {
    const out = cards([TOOL_SEED, toolcall({ type: 'toolcall_start', contentIndex: 1 }), ...deltas]);
    // Every fragment renders under omp's own id and name — before this, all of
    // them fell back to `tool-1` / `tool`, which remounted the card at
    // `toolcall_end` and drew the header as a bare `Tool`.
    expect(new Set(out.map((c) => c.id))).toEqual(new Set(['call_abc']));
    expect(new Set(out.map((c) => c.name))).toEqual(new Set(['bash']));
  });

  test('grows the arguments as they stream instead of delivering them at the end', () => {
    const out = cards([TOOL_SEED, toolcall({ type: 'toolcall_start', contentIndex: 1 }), ...deltas]);
    // The subtitle, the subject chip and the indicator's verb all read
    // `arguments`; without it every fragment of the call rendered as a bare
    // card and the whole tool call appeared in one step at `toolcall_end`.
    expect(out.at(-1)?.args).toEqual({ command: 'echo hi' });
    // A half-arrived value is NOT reported: the first fragments are `{"comm`,
    // `{"comm` + `and":"ec` … and none of them may surface a key — a repaired
    // `{"comm"` would render `comm` as the subject, and a guessed number would
    // be worse. The property is that only the completed pair appears, once.
    const shapes = out.map((c) => c.args);
    // Only the fragment that COMPLETED the pair reports anything; the two
    // before it report nothing rather than a guessed `comm`/`ec`.
    expect(shapes).toEqual([undefined, undefined, undefined, { command: 'echo hi' }]);
  });

  test('toolcall_end still hands over the authoritative block', () => {
    const acc = createDeltaAccumulator();
    acc.apply(TOOL_SEED);
    acc.apply(toolcall({ type: 'toolcall_start', contentIndex: 1 }));
    for (const delta of deltas) acc.apply(delta);
    const end = acc.apply(toolcall({
      type: 'toolcall_end',
      contentIndex: 1,
      toolCall: { type: 'toolCall', id: 'call_abc', name: 'bash', arguments: { command: 'echo hi' } },
    }));
    expect(end?.message.content).toMatchObject([
      { type: 'text' },
      { type: 'toolCall', id: 'call_abc', name: 'bash', arguments: { command: 'echo hi' } },
    ]);
  });

  test('text blocks still reset on _start so seeded prose is not doubled', () => {
    // The tool-call carve-out must not weaken the rule it sits beside.
    const acc = createDeltaAccumulator();
    acc.apply(SEED);
    acc.apply(update({ type: 'text_start', contentIndex: 0 }));
    acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'hel' }));
    const applied = acc.apply(update({ type: 'text_delta', contentIndex: 0, delta: 'lo' }));
    expect(applied?.message.content).toMatchObject([{ type: 'text', text: 'hello' }]);
  });
});
