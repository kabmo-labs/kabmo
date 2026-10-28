/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Read-only full-JSONL loader for a single oh-my-pi session file, mapping the
 * omp message stream to Kabmo ChatMessageData shape so the chat timeline
 * renders faithfully (thinking accordions, tool calls with their results,
 * assistant text, user turns).
 *
 * omp writes one JSONL entry per message turn, but a single assistant entry
 * may hold several blocks: thinking, toolCall, toolResult and text. The
 * mapping below:
 *   - turns each omp "message" entry into one ChatMessageData
 *   - lifts `thinking` blocks into msg.thinking
 *   - lifts `toolCall` blocks into msg.toolCalls (ToolCallData)
 *   - pairs toolResult blocks with the toolCallId of their tool call and folds
 *     their text into that tool's `output` (skipping image/refusal payloads)
 *   - joins text blocks into msg.content
 */

import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import { normalizeThinkingLevel } from '@/shared/lib/models/thinking-levels';
import type { ChatMessageData } from '@/shared/types/chat';
import { collectToolOutputs, noticeFromCustomMessage, toChatMessage, type SequenceState } from '@/shared/lib/omp/session/messages-map';
import type { OmpMessageEntry } from '@/shared/lib/omp/session/messages-parse';
import { operatorTitleFromEntry } from '@/shared/lib/omp/session/operator-title';
import { isRecord } from '@/shared/lib/util/guards';
import { readBlobRef } from '@/server/lib/omp/session/blobs.server';

const MAX_SESSION_LOAD_BYTES = 512 * 1024 * 1024;

/** omp expands `/skill:<name>` into a `custom_message` record and stores no
 *  user message for it, so Kabmo reconstructs the bubble from it.
 *
 *  The bubble text comes from the SAME rule the sidebar row and the title use
 *  (`operatorTitleFromEntry`) — `/skill:<name>` plus the operator's args — so
 *  the timeline, the sidebar and the header cannot show three spellings of one
 *  turn. It read `/skill:<name>` alone before, which dropped the args the user
 *  had typed and disagreed with omp's own chip. */
function skillUserMessageFromRecord(record: Record<string, unknown>): ChatMessageData | null {
  const content = operatorTitleFromEntry(record);
  if (!content) return null;
  const parsed = typeof record.timestamp === 'string' ? new Date(record.timestamp) : undefined;
  const time = parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : undefined;
  return {
    id: typeof record.id === 'string' ? record.id : `skill-${Date.now()}`,
    role: 'user',
    content,
    date: time ? `Today, ${time}` : undefined,
    timestamp: time,
  };
}

/**
 * Load a session file and return the chat timeline in **file order** — the
 * order omp wrote the entries, which is the session's chronology. The API
 * response is a faithful projection of the JSONL: nothing here reorders rows,
 * and no display-side reordering is applied anywhere either (a notice row
 * renders exactly where omp wrote it).
 *
 * `liveRun` says whether a run for this session is in flight RIGHT NOW. It is
 * the only thing that can tell a call still blocking (whose result omp has not
 * written yet) from one whose process died before writing it — the two
 * transcripts are identical. Only the first is `running`; the second keeps the
 * settled shape, because a crash must not leave a spinner in scrollback.
 */
export async function loadSessionMessages(
  filePath: string,
  options: { liveRun?: boolean } = {},
): Promise<ChatMessageData[]> {
  try {
    const file = Bun.file(filePath);
    if ((await file.stat()).size > MAX_SESSION_LOAD_BYTES) return [];
  } catch {
    return [];
  }

  let body: string;
  try {
    body = await Bun.file(filePath).text();
  } catch {
    return [];
  }

  const records = parseJsonlLenient<Record<string, unknown>>(body);
  const state: SequenceState = { messages: [], outputsByCall: collectToolOutputs(records) };
  // omp records the thinking level as separate `thinking_level_change` entries
  // (session state), not as a per-message field. Walk the records in order and
  // stamp the level in effect onto each assistant turn so the footer shows the
  // level that actually served it — not the last level used in the session.
  let currentLevel: string | undefined;
  const levelFor = (record: Record<string, unknown>): string | undefined => {
    if (record?.type === 'thinking_level_change') {
      currentLevel = normalizeThinkingLevel(record.thinkingLevel);
    }
    return currentLevel;
  };

  for (const record of records) {
    const level = levelFor(record);
    if (record?.type === 'custom_message' && record.customType === 'skill-prompt') {
      const skillMsg = skillUserMessageFromRecord(record);
      if (skillMsg) {
        state.messages.push(skillMsg);
        continue;
      }
    }
    if (record?.type === 'custom_message' || record?.type === 'custom') {
      const notice = noticeFromCustomMessage(record);
      if (notice) state.messages.push(notice);
      continue;
    }
    if (record?.type !== 'message') continue;
    const mapped = toChatMessage(record as unknown as OmpMessageEntry);
    if (!mapped) continue;
    if (level !== undefined && mapped.role !== 'user') {
      mapped.thinkingLevel = level;
    }
    // Fold the collected outputs into this message's tool calls.
    if (mapped.toolCalls?.length) {
      mapped.toolCalls = mapped.toolCalls.map((call) => {
        const collected = state.outputsByCall.get(call.id);
        const images = call.images ?? collected?.images;
        // A call with no result entry yet is only RUNNING when the run is
        // actually live (see `liveRun`); its empty output is "not written yet"
        // rather than an answer. Reporting it as a settled success drew a
        // blocking `wait` as a finished call with nothing in it.
        const pending = collected?.pending === true && options.liveRun === true;
        return {
          ...call,
          output: pending ? undefined : call.output || collected?.output || undefined,
          details: (call.details || collected?.details || undefined) as Record<string, any> | undefined,
          ...(collected?.durationMs !== undefined ? { durationMs: collected.durationMs } : {}),
          ...(collected?.startedAt !== undefined ? { startedAt: collected.startedAt } : {}),
          ...(images && images.length > 0 ? { images } : {}),
          status: pending ? 'running' : collected?.isError ? 'error' : call.status,
        };
      });
    }
    state.messages.push(mapped);
  }
  await resolveImageBlobs(state.messages);
  return state.messages;
}

/**
 * Replace `blob:sha256:` image references with the bytes they point at.
 *
 * omp externalizes a large attached image out of the session JSONL: the entry
 * keeps the ref, the bytes go to the blob store. Only omp's own loader resolves
 * them, so a reloaded Kabmo session used to render
 * `data:image/png;base64,blob:sha256:…` — a data URL whose payload is the ref
 * string, which the browser cannot decode. The ref itself is dropped once
 * resolved; an unresolvable one leaves the attachment with no preview rather
 * than a broken image.
 */
async function resolveImageBlobs(messages: ChatMessageData[]): Promise<void> {
  const pending: Promise<void>[] = [];
  for (const message of messages) {
    for (const attachment of message.attachments ?? []) {
      // `blobRef` rides the attachment only until the bytes are read back; it is
      // not part of the public attachment shape, so narrow before touching it.
      if (!('blobRef' in attachment) || typeof attachment.blobRef !== 'string') continue;
      const ref = attachment.blobRef;
      delete attachment.blobRef;
      pending.push(
        readBlobRef(ref).then((bytes) => {
          if (bytes) {
            attachment.preview = `data:${attachment.type ?? 'image/png'};base64,${bytes.toString('base64')}`;
          }
        }),
      );
    }
  }
  await Promise.all(pending);
}

/** Derive the display title from the JSONL header/title slot (cheap read). */
export async function loadSessionTitle(filePath: string): Promise<string | undefined> {
  try {
    // A bounded Blob slice, and deliberately NO size guard. The title slot and
    // the session header live in the first few hundred bytes, so the 32 KiB
    // window is what makes the read cheap — a file-size refusal on top of it
    // only discarded titles that were sitting right there (measured: an 11 MB
    // session reported `title: undefined` while its title slot held
    // "Debug file attachment read failure").
    const head = await Bun.file(filePath).slice(0, 32 * 1024).text();
    const records = parseJsonlLenient<Record<string, unknown>>(head);
    const first = records[0];
    if (first?.type === 'title' && typeof first.title === 'string' && first.title.trim()) {
      return first.title.trim();
    }
    const header = records.find((r) => r?.type === 'session');
    if (typeof header?.title === 'string' && header.title.trim()) {
      return header.title.trim();
    }
    // Fallback: extract from session_init task
    const init = records.find((r) => r?.type === 'session_init');
    if (init && typeof init.task === 'string' && init.task.trim()) {
      const taskLines = init.task.trim().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('Complete assignment'));
      if (taskLines.length > 0) {
        return taskLines[0].slice(0, 60);
      }
    }
    // Fallback: the operator's opening turn — a `user` message, or the
    // `/skill:<name> <args>` chip a skill turn stands for. One rule for the
    // header, the sidebar row and the timeline bubble, so the three cannot
    // disagree about what a session is called.
    for (const record of records) {
      if (!isRecord(record)) continue;
      const operator = operatorTitleFromEntry(record);
      if (!operator) continue;
      const lines = operator.trim().split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('Complete assignment'));
      if (lines.length > 0) return lines[0].slice(0, 60);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Resolve the model last used by a session from its `model_change` entries
 *  (omp records `"provider/model-id"`). Returns undefined when the file has
 *  no model_change entry or the value is malformed. */
export async function loadSessionModel(filePath: string): Promise<{ provider: string; modelId: string } | undefined> {
  try {
    const file = Bun.file(filePath);
    if ((await file.stat()).size > MAX_SESSION_LOAD_BYTES) return undefined;
  } catch {
    return undefined;
  }
  try {
    const body = await Bun.file(filePath).text();
    const records = parseJsonlLenient<Record<string, unknown>>(body);
    let last: { provider: string; modelId: string } | undefined;
    for (const record of records) {
      if (record?.type !== 'model_change') continue;
      const model = typeof record.model === 'string' ? record.model : undefined;
      if (!model) continue;
      const slash = model.indexOf('/');
      if (slash <= 0 || slash === model.length - 1) continue;
      last = { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
    }
    return last;
  } catch {
    return undefined;
  }
}

/** Resolve the thinking level last used by a session from its
 *  `thinking_level_change` entries (omp records the level string, e.g.
 *  "off" | "minimal" | "low" | "medium" | "high" | "max"). */
export async function loadSessionThinkingLevel(filePath: string): Promise<string | undefined> {
  return readThinkingSelector(filePath, (record) => normalizeThinkingLevel(record.thinkingLevel));
}

/**
 * The thinking SELECTOR a session is configured with — `auto` when automatic
 * per-turn classification is on, else the concrete level.
 *
 * omp writes both fields on one entry (`thinkingLevel` = the provisional
 * concrete effort, `configured` = the selector) and restores with
 * `parseConfiguredThinkingLevel(configured) ?? parseThinkingLevel(level)`, so a
 * reader that takes `thinkingLevel` alone turns an `auto` session into a pinned
 * one. Anything spawning a child that must classify its turns the way the
 * session does has to read this, not the concrete level.
 */
export async function loadSessionThinkingSelector(filePath: string): Promise<string | undefined> {
  return readThinkingSelector(filePath, (record) =>
    typeof record.configured === 'string' && record.configured
      ? record.configured
      : normalizeThinkingLevel(record.thinkingLevel),
  );
}

async function readThinkingSelector(
  filePath: string,
  read: (record: Record<string, unknown>) => string,
): Promise<string | undefined> {
  try {
    const file = Bun.file(filePath);
    if ((await file.stat()).size > MAX_SESSION_LOAD_BYTES) return undefined;
  } catch {
    return undefined;
  }
  try {
    const body = await Bun.file(filePath).text();
    const records = parseJsonlLenient<Record<string, unknown>>(body);
    let last: string | undefined;
    for (const record of records) {
      if (record?.type !== 'thinking_level_change') continue;
      last = read(record);
    }
    return last;
  } catch {
    return undefined;
  }
}
