/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The transcript an ACP session writes for itself.
 *
 * A chat Kabmo spawns SERVER-SIDE — an orchestration worker, a CLI child — has
 * no tab, and the client is the only writer of `chat_sessions` for an ACP chat.
 * The agent holds the conversation, but `session/load` is the only way to read
 * it back and that needs a dead process. So the frames the driver already
 * receives are folded here, as they stream, into the rows the timeline reads.
 *
 * The store is `acp_transcripts`, NOT `chat_sessions`: a tab that IS open keeps
 * writing the richer row (attachment chips, notice rows) and must not be
 * overwritten by this fallback. The loader prefers `chat_sessions` and reads
 * this table only when that row is empty.
 *
 * The fold is deliberately the same one the reload path uses
 * (`chatMessageFromEvent`), so a recorded row and a replayed row agree.
 */

import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import { chatMessageFromEvent } from '@kabmo-labs/kabmo-acp-session-core/replay-transcript';
import { hasAssistantRow } from '@/shared/lib/chat/transcript-rows';
import {
  pairToolOutputs,
  putToolResult,
  recordToolResult,
  resultDetails,
  type ToolResultHost,
  type ToolResultRecord,
} from '@/shared/lib/chat/omp/tool-results';
import { toolResultText } from '@kabmo-labs/kabmo-omp-mapper';
import { extractToolImages } from '@kabmo-labs/kabmo-omp-session-parse/tool-images';
import type { ChatMessageData } from '@kabmo-labs/kabmo-chat-contracts/chat';
import type { AgentEvent } from '@kabmo-labs/kabmo-omp-rpc-protocol/constants';

/** One write per burst. A turn emits a frame per chunk; the row is the unit. */
const FLUSH_DEBOUNCE_MS = 250;
/** The display attachments an image-only prompt carries. */
function imageAttachments(images: unknown): ChatMessageData['attachments'] {
  if (!Array.isArray(images)) return undefined;
  const rows = images.flatMap((image) => {
    if (!image || typeof image !== 'object') return [];
    const record = image as { data?: unknown; mimeType?: unknown };
    if (typeof record.data !== 'string' || typeof record.mimeType !== 'string') return [];
    return [{
      name: 'image',
      preview: `data:${record.mimeType};base64,${record.data}`,
      type: record.mimeType,
    }];
  });
  return rows.length > 0 ? rows : undefined;
}

/** The newest row's clock, for deciding which copy is ahead. */
function lastRowTime(rows: readonly ChatMessageData[]): number {
  let newest = 0;
  for (const row of rows) {
    const time = typeof row.startedAt === 'number'
      ? row.startedAt
      : row.date
        ? Date.parse(row.date)
        : 0;
    if (Number.isFinite(time) && time > newest) newest = time;
  }
  return newest;
}

/** The client-written row, when it exists. */
async function loadStoredMessages(sessionId: string): Promise<ChatMessageData[]> {
  const db = await getDb();
  const row = await db.get<{ messages: string }>(
    'SELECT messages FROM chat_sessions WHERE session_id = ?',
    [sessionId],
  );
  if (!row?.messages) return [];
  try {
    const parsed: unknown = JSON.parse(row.messages);
    return Array.isArray(parsed) ? (parsed as ChatMessageData[]) : [];
  } catch {
    return [];
  }
}

/**
 * The recorded rows over the client's row, keeping what only the client has.
 *
 * A tab's copy carries attachment chips and notice rows this fold does not
 * build; replacing it wholesale would drop them. Rows are matched by message
 * id, and a user turn by its text (the composer's optimistic id is local to the
 * tab, so the same prompt has two ids).
 */
function mergeTranscripts(
  recorded: readonly ChatMessageData[],
  stored: readonly ChatMessageData[],
): ChatMessageData[] {
  if (stored.length === 0) return [...recorded];
  const merged = [...stored];
  const indexById = new Map(merged.map((row, index) => [row.id, index]));
  const userIdByText = new Map<string, string>();
  for (const row of merged) {
    if (row.role === 'user' && row.content.trim()) userIdByText.set(row.content.trim(), row.id);
  }
  for (const row of recorded) {
    const existing = indexById.get(row.id);
    if (existing !== undefined) {
      merged[existing] = row;
      continue;
    }
    if (row.role === 'user' && userIdByText.has(row.content.trim())) continue;
    indexById.set(row.id, merged.length);
    merged.push(row);
    if (row.role === 'user' && row.content.trim()) userIdByText.set(row.content.trim(), row.id);
  }
  return merged;
}

/**
 * Fold one session's frames into transcript rows and persist them.
 *
 * One instance per live ACP session. `recordPrompt` is called by the driver
 * (the agent never echoes a live user turn), `record` by `emit`, and `flush`
 * on the turn's end and on process exit.
 */
export class AcpTranscriptRecorder {
  private readonly rows: ChatMessageData[] = [];
  private readonly indexById = new Map<string, number>();
  private readonly toolResultsRef = { current: new Map<string, ToolResultRecord>() };
  private readonly lastToolMessageRef = { current: null as ChatMessageData | null };
  private readonly host: ToolResultHost = {
    toolResultsRef: this.toolResultsRef,
    lastToolMessageRef: this.lastToolMessageRef,
  };
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private promptSeq = 0;
  private disposed = false;

  constructor(private readonly sessionId: () => string) {}

  /**
   * Load the rows a previous process recorded for this session.
   *
   * A resumed chat keeps its id, and the recorder starts empty in a new
   * process; without this the first flush would replace the whole conversation
   * with the new turn. Called once, before the first prompt.
   */
  async hydrate(): Promise<void> {
    const recorded = await loadAcpTranscript(this.sessionId());
    const stored = await loadStoredMessages(this.sessionId());
    // The client's row is richer (attachment chips, notices); the recorder's
    // may be ahead (a turn no tab wrote). Take whichever is newer, so the
    // recorder's next flush is a superset of both.
    const base = lastRowTime(stored) > lastRowTime(recorded) ? stored : recorded;
    for (const row of base) this.upsert(row);
    this.dirty = false;
  }

  /** Record the user turn. The ACP mapper drops live `user_message` frames as
   *  receipts for a bubble the composer drew, so this is the only copy. */
  recordPrompt(text: string, images?: unknown): void {
    if (this.disposed) return;
    const content = text.trim();
    if (!content) return;
    const attachments = imageAttachments(images);
    this.upsert({
      id: `prompt-${++this.promptSeq}-${Date.now()}`,
      role: 'user',
      content,
      startedAt: Date.now(),
      ...(attachments ? { attachments } : {}),
    });
    this.schedule();
  }

  /** Fold one agent frame. Unknown frames are ignored, never guessed at. */
  record(event: AgentEvent): void {
    if (this.disposed) return;
    switch (event.type) {
      case 'user_turn':
        this.recordPrompt(String(event.message ?? ''), event.images);
        return;
      case 'message_start':
      case 'message_update':
      case 'message_end': {
        const message = event.message;
        if (!message || typeof message !== 'object' || Array.isArray(message)) return;
        const record = message as Record<string, unknown>;
        if (record.role === 'toolResult') {
          recordToolResult(record, this.host);
          this.repaint(typeof record.toolCallId === 'string' ? record.toolCallId : undefined);
          return;
        }
        const row = chatMessageFromEvent(event);
        if (!row) return;
        this.upsert(pairToolOutputs(row, this.host));
        if (event.type === 'message_end') this.schedule();
        return;
      }
      case 'tool_execution_start': {
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
        if (!callId) return;
        putToolResult(this.host, callId, { output: '', startedAt: Date.now(), pending: true });
        this.repaint(callId);
        return;
      }
      case 'tool_execution_update': {
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
        if (!callId) return;
        const stored = this.toolResultsRef.current.get(callId);
        const output = typeof event.output === 'string' && event.output.length > 0
          ? event.output
          : toolResultText(event.partialResult);
        const details = resultDetails(event) ?? stored?.details;
        putToolResult(this.host, callId, {
          output: output || stored?.output || '',
          ...(details ? { details } : {}),
          pending: true,
        });
        this.repaint(callId);
        return;
      }
      case 'tool_execution_end': {
        const callId = typeof event.toolCallId === 'string' ? event.toolCallId : undefined;
        if (!callId) return;
        const startedAt = this.toolResultsRef.current.get(callId)?.startedAt;
        const images = extractToolImages(event.result);
        putToolResult(this.host, callId, {
          output: typeof event.output === 'string' && event.output.length > 0
            ? event.output
            : toolResultText(event.result),
          isError: event.isError === true,
          details: resultDetails(event),
          pending: false,
          ...(startedAt !== undefined ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
          ...(images.length > 0 ? { images } : {}),
        });
        this.repaint(callId);
        return;
      }
      case 'agent_end':
        void this.flush();
        return;
      default:
        return;
    }
  }

  /** Persist the rows so far. A no-op when nothing changed. */
  async flush(): Promise<void> {
    if (!this.dirty || this.disposed) return;
    const sessionId = this.sessionId();
    if (!sessionId) return;
    this.dirty = false;
    const stored = await loadStoredMessages(sessionId);
    const rows = mergeTranscripts(this.rows, stored);
    try {
      const db = await getDb();
      await db.run(
        `INSERT INTO acp_transcripts (session_id, messages, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           messages = excluded.messages,
           updated_at = excluded.updated_at`,
        [sessionId, JSON.stringify(rows), Date.now()],
      );
      // A turn no tab wrote would otherwise be invisible: the loader prefers
      // `chat_sessions` when it holds an answer. Write it only when this copy is
      // AHEAD, so an open tab's newer (and richer) row is never replaced.
      if (!hasAssistantRow(stored) || lastRowTime(rows) > lastRowTime(stored)) {
        const titleRow = await db.get<{ title: string }>(
          'SELECT title FROM chat_sessions WHERE session_id = ?',
          [sessionId],
        );
        await db.run(
          `INSERT INTO chat_sessions (session_id, title, messages, updated_at)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(session_id) DO UPDATE SET
             messages = excluded.messages,
             updated_at = CURRENT_TIMESTAMP`,
          [sessionId, titleRow?.title || `Session ${sessionId}`, JSON.stringify(rows)],
        );
      }
    } catch (error) {
      // A failed write is not a lost turn: the next frame retries, and the
      // restore path can replay the agent's own history.
      this.dirty = true;
      console.error('[harness] could not record the ACP transcript:', error);
    }
  }

  /** Flush the last rows and stop the timer (process exit). */
  dispose(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    void this.flush();
    this.disposed = true;
  }

  private upsert(row: ChatMessageData): void {
    const existing = this.indexById.get(row.id);
    if (existing !== undefined) {
      this.rows[existing] = row;
    } else {
      this.indexById.set(row.id, this.rows.length);
      this.rows.push(row);
    }
    this.dirty = true;
  }

  /** Re-pair the row that owns a call after its result changed. */
  private repaint(callId: string | undefined): void {
    if (!callId) return;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      if (!row.toolCalls?.some((call) => call.id === callId)) continue;
      this.rows[index] = pairToolOutputs(row, this.host);
      this.dirty = true;
      return;
    }
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, FLUSH_DEBOUNCE_MS);
    this.timer.unref?.();
  }
}

/** The recorded rows for a session, or empty when it has none. */
export async function loadAcpTranscript(sessionId: string): Promise<ChatMessageData[]> {
  const db = await getDb();
  const row = await db.get<{ messages: string }>(
    'SELECT messages FROM acp_transcripts WHERE session_id = ?',
    [sessionId],
  );
  if (!row?.messages) return [];
  try {
    const parsed: unknown = JSON.parse(row.messages);
    return Array.isArray(parsed) ? (parsed as ChatMessageData[]) : [];
  } catch {
    return [];
  }
}
