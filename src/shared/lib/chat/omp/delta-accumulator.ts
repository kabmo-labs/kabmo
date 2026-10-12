/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rebuilds the accumulated assistant message when omp streams in DELTA mode.
 *
 * `set_event_filter` with `messageUpdates: "delta"` makes omp stop attaching the
 * accumulated message to every `message_update` frame: `message` shrinks to
 * `{ role }` and `assistantMessageEvent.partial` is omitted, leaving only the
 * new fragment (`delta`). Measured on one 300-word prompt: 10.9 MB / 2217 frames
 * accumulated against 108 KB / 486 delta — ~101x, because the accumulated shape
 * re-sends the whole message on every token.
 *
 * The rest of the pipeline is written against the ACCUMULATED shape
 * (`toChatMessage(msg)`, `describeAssistantPhase(event)` reading
 * `event.partial.content[contentIndex]`), so this module's job is narrow: fold
 * the fragments back into that shape and hand it on. Nothing downstream learns
 * that the transport changed.
 *
 * The frame shapes this relies on were measured on omp 18.8.3 and re-measured
 * on 18.10.0:
 *
 *   message_start        `message.content` = the FULL message, no
 *                        `assistantMessageEvent` — the seed.
 *   message_update       `message` = `{role}`, `assistantMessageEvent` = one of
 *                        `text_start|text_delta|text_end` (and the thinking /
 *                        toolcall / image equivalents) with `contentIndex`.
 *   message_end          `message.content` = the full message again — the
 *                        authority, so the rebuild is discarded here.
 *
 * A tool call is the one block whose SEED matters beyond its row identity. The
 * seed's block carries omp's `id` and `name`, the deltas carry neither, and
 * `toolcall_end` is the first frame to repeat them — so the rebuild keeps the
 * identity across `toolcall_start` and parses the accumulating argument text
 * into `arguments` on every fragment, which is the field the accumulated shape
 * carries and every reader of a tool card depends on. Both rules were bugs
 * first: without them a streamed call rendered as a bare **Tool** card with no
 * subtitle, and the run's whole tool call appeared in one step at
 * `toolcall_end` instead of growing. See `partial-json.ts` and
 * `toolCallIdentity`.
 *
 * A build that ignores `set_event_filter` sends the accumulated message on
 * every update; those frames carry content and pass through untouched, so the
 * accumulator is inert rather than wrong on such a child.
 *
 * The rebuild also owns the ROW IDENTITY. A seeded stream takes it from the
 * seed's `timestamp`; a client that attached after `message_start` (a reload, a
 * second tab, a session switched to while it streams) has no seed, and there
 * the wire `messageId` — the one field every frame of the message carries — is
 * what keeps the fragments on a single row. See `rowId`.
 */

import { isRecord } from '@/shared/lib/util/guards';
import { parsePartialJsonObject } from '@/shared/lib/omp/session/partial-json';

interface Accumulated {
  blocks: Array<Record<string, unknown>>;
  /** The static fields of the message (timestamp, model, provider, …) taken
   *  from the frame that carried it whole. `toChatMessage` reads them, and the
   *  timeline keys rows on the id derived from them — a rebuild that dropped
   *  them minted a fresh `msg-<now>-ai` per token and appended a row per
   *  fragment. */
  meta: Record<string, unknown>;
  /** True once a fragment has been applied; a later full `message` then wins. */
  touched: boolean;
  /** Row id adopted from the WIRE when this message carries no identity of its
   *  own, because the client attached after `message_start` and never saw the
   *  seed that supplies the timestamp a row id is derived from. Every frame of
   *  one message shares its `messageId`, so that is the only id available this
   *  early — without it each fragment minted `msg-<now>-ai` and appended its
   *  own row. See `hasIdentity`. */
  rowId?: string;
}

export interface DeltaAccumulator {
  /**
   * Fold one frame and return what the downstream reader should see, or
   * `undefined` to pass the frame through untouched. `event` is absent when
   * only the message was rewritten (the `message_end` of a stream whose
   * fragments were keyed by the wire id).
   */
  apply(frame: Record<string, unknown>): { event?: Record<string, unknown>; message: Record<string, unknown> } | undefined;
  /** Forget one message (its terminal frame arrived, or a session switched). */
  clear(messageId: string | undefined): void;
  /** Forget everything (session switch, disconnect). */
  reset(): void;
}

/** The block a start/delta/end event names, or null for anything else. */
function blockKind(eventType: string): 'text' | 'thinking' | 'toolcall' | 'image' | null {
  const base = eventType.replace(/_(start|delta|end)$/, '');
  if (base === 'text' || base === 'thinking' || base === 'toolcall' || base === 'image') return base;
  return null;
}

/** Which block field a fragment accumulates into. `toolcall` streams JSON. */
const ACCUMULATED_FIELD: Record<string, 'text' | 'thinking' | 'partialArgs'> = {
  text: 'text',
  thinking: 'thinking',
  toolcall: 'partialArgs',
};

/**
 * The identity fields a streamed tool call must survive its `toolcall_start`
 * reset with: omp's `id` (the card's React key and its `toolResultsRef` key)
 * and `name` (which drives the icon, the panel and the header's title). Both
 * arrive only on the seed and again on `toolcall_end`, so dropping them blanks
 * the card for the whole stream. `streamIndex` rides along because the
 * accumulated shape carries it and nothing else re-adds it.
 */
function toolCallIdentity(block: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!isRecord(block)) return {};
  const identity: Record<string, unknown> = {};
  for (const key of ['id', 'name', 'streamIndex'] as const) {
    if (block[key] !== undefined) identity[key] = block[key];
  }
  return identity;
}

export function createDeltaAccumulator(): DeltaAccumulator {
  const byMessage = new Map<string, Accumulated>();

  function bucket(messageId: string): Accumulated {
    let entry = byMessage.get(messageId);
    if (!entry) {
      entry = { blocks: [], meta: {}, touched: false };
      byMessage.set(messageId, entry);
    }
    return entry;
  }

  function seed(entry: Accumulated, message: Record<string, unknown> | undefined): void {
    if (entry.touched || !Array.isArray(message?.content)) return;
    entry.blocks = message.content.filter(isRecord).map((block) => ({ ...block }));
    const { content: _content, ...meta } = message;
    entry.meta = meta;
  }

  function apply(frame: Record<string, unknown>): { event?: Record<string, unknown>; message: Record<string, unknown> } | undefined {
    const message = isRecord(frame.message) ? frame.message : undefined;
    const explicitId = typeof frame.messageId === 'string'
      ? frame.messageId
      : (typeof message?.id === 'string' ? message.id : undefined);
    const messageId = explicitId ?? 'anonymous';
    const rawEvent = frame.assistantMessageEvent;

    // `message_start`: the full message, and the seed every later fragment
    // extends. No `assistantMessageEvent`, so nothing downstream reads it.
    if (!isRecord(rawEvent)) {
      if (frame.type === 'message_start') {
        const entry = bucket(messageId);
        entry.touched = false;
        seed(entry, message);
      } else if (frame.type === 'message_end') {
        // The finished message is the authority, but it carries its own
        // timestamp while the fragments of a message the client attached
        // mid-stream were keyed by the wire id. Handing the adopted id back
        // keeps the terminal frame on the row the stream drew, instead of
        // appending a second, complete row beside the partial one.
        const adopted = byMessage.get(messageId)?.rowId;
        if (adopted && message && message.id === undefined) {
          return { message: { ...message, id: adopted } };
        }
      }
      return undefined;
    }

    const eventType = typeof rawEvent.type === 'string' ? rawEvent.type : '';
    const kind = blockKind(eventType);
    if (!kind) return undefined;
    const entry = bucket(messageId);

    // A frame carrying the accumulated message is not a delta frame: leave the
    // whole frame alone and let the caller use it as-is.
    if (Array.isArray(message?.content) && message.content.length > 0 && !entry.touched) {
      return undefined;
    }

    // Adopt the WIRE id as the row id when nothing on this message can produce
    // one: a client that attached after `message_start` has no seed, and a
    // delta frame's message is `{role}` only, so without this every fragment
    // minted `msg-<now>-ai` and appended its own row. Measured through the real
    // transport: one 151-fragment run, attached 6.5 s in, rendered 151 cards.
    const carriesIdentity = [entry.meta, message].some(
      (candidate) => !!candidate && (typeof candidate.id === 'string' || candidate.timestamp !== undefined),
    );
    if (!entry.rowId && explicitId && !carriesIdentity) entry.rowId = explicitId;

    const index = typeof rawEvent.contentIndex === 'number' ? rawEvent.contentIndex : -1;
    if (index < 0) return undefined;
    while (entry.blocks.length <= index) entry.blocks.push({});

    const block = entry.blocks[index];
    if (eventType.endsWith('_start')) {
      // The seed can already hold this block's finished text (`message_start`
      // carries the whole message on some builds) while the deltas for it
      // still stream. Starting a block therefore REPLACES it, so the fragments
      // rebuild from zero instead of appending onto the seed and doubling the
      // text — measured on omp 18.8.3: a seeded 58-char answer accumulated to
      // 116 before `text_end` corrected it.
      //
      // A TOOL CALL is the exception, and the identity is what it must keep:
      // the seed's block already carries omp's real `id` and `name`, while the
      // deltas carry neither — `toolcall_delta` has only `{contentIndex,
      // delta}`, and `toolcall_end` is the first frame to repeat them. Resetting
      // the whole block therefore blanked both for the entire stream and the
      // card fell back to `name: 'tool'`, which renders as a bare **Tool**
      // title with no subtitle (measured on omp 18.10.0 delta mode: every
      // fragment of a `bash` call drew `title="Tool"`, and only `toolcall_end`
      // snapped it to `Bash — echo alpha`). Only the accumulating field is
      // reset, so the text-doubling rule above still holds.
      entry.blocks[index] = kind === 'toolcall'
        ? { type: 'toolCall', ...toolCallIdentity(block) }
        : { type: kind };
      entry.touched = true;
    } else if (eventType.endsWith('_delta')) {
      const field = ACCUMULATED_FIELD[kind];
      block.type = kind === 'toolcall' ? 'toolCall' : kind;
      block[field] = (typeof block[field] === 'string' ? block[field] : '') + (typeof rawEvent.delta === 'string' ? rawEvent.delta : '');
      // The accumulated shape carries `arguments` PARSED (`omp` runs
      // `parseStreamingJsonThrottled` on the buffer it is building), and that
      // field is what the card's subtitle, its subject chip and the indicator's
      // verb read. Delta mode leaves only the raw text, so it is parsed here on
      // every fragment — otherwise a tool card had no arguments at all until
      // `toolcall_end` arrived, and the run's whole tool call appeared in one
      // step instead of growing. See `partial-json.ts` for why a still-arriving
      // value is dropped rather than guessed.
      if (kind === 'toolcall') {
        const parsed = parsePartialJsonObject(block[field] as string);
        if (parsed) block.arguments = parsed;
      }
      entry.touched = true;
    } else if (eventType.endsWith('_end')) {
      // `toolcall_end` and `image_end` hand over the finished block whole;
      // text/thinking end with their complete string.
      const handed = kind === 'toolcall' ? rawEvent.toolCall : kind === 'image' ? rawEvent.content : undefined;
      if (isRecord(handed)) {
        entry.blocks[index] = { ...handed };
      } else {
        block.type = kind;
        if (typeof rawEvent.content === 'string') block[kind] = rawEvent.content;
      }
      entry.touched = true;
    }

    // Delta mode omits `partial`; synthesize it so the existing phase reader
    // (`describeAssistantPhase` → `event.partial.content[contentIndex]`) and
    // `toChatMessage` keep working unchanged.
    //
    // `entry.meta` (the seed's `timestamp`, model, provider) is applied so
    // `toChatMessage` derives the SAME row id it would from the accumulated
    // message — `msg-<timestamp>-ai`. The delta frames carry only `{role}`, and
    // without the timestamp every token would mint `msg-<now>-ai` and append a
    // row; `message_end` carries the same timestamp, so the terminal frame
    // updates the row the stream was drawing. When there is no seed to take a
    // timestamp from, `entry.rowId` (the wire id) is what keeps the fragments
    // on one row — and `message_end` is stamped with it too, above.
    const rebuilt: Record<string, unknown> = {
      ...(message ?? {}),
      ...entry.meta,
      content: entry.blocks,
      ...(entry.rowId ? { id: entry.rowId } : {}),
    };
    return { event: { ...rawEvent, partial: rebuilt }, message: rebuilt };
  }

  return {
    apply,
    clear(messageId) {
      if (messageId) byMessage.delete(messageId);
    },
    reset() {
      byMessage.clear();
    },
  };
}
