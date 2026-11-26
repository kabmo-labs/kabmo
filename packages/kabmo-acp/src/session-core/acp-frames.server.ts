/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw `session/update` frames an ACP session received, and the page the
 * context panel's Raw Messages view reads.
 *
 * The transcript (`acp_transcripts`) is Kabmo's REFACTORED view: one row per
 * message, tool calls folded in, chunks merged. The raw panel exists to show
 * what the agent actually sent, so it reads these frames — the original ACP
 * payloads — and never the fold. A frame is written once, in arrival order,
 * with the `sessionUpdate` kind and the role it maps to denormalized so the
 * panel can page and filter without parsing every payload.
 *
 * Writes are batched on the same debounce as the transcript recorder: a turn
 * emits a frame per chunk, and one INSERT per chunk would put SQLite on the
 * hot path of every token.
 */

import { getDb } from '@kabmo-labs/kabmo-db/lifecycle';
import type { RawMessageItem } from '@kabmo-labs/kabmo-app-contracts/context';

const FLUSH_DEBOUNCE_MS = 250;

export type AcpFrameRole = 'user' | 'assistant' | 'system';

/** The role the panel's filter uses for one `sessionUpdate` kind. */
export function frameRole(kind: string): AcpFrameRole {
  if (kind === 'user_message_chunk') return 'user';
  if (
    kind === 'agent_message_chunk' ||
    kind === 'agent_thought_chunk' ||
    kind === 'tool_call' ||
    kind === 'tool_call_update'
  ) {
    return 'assistant';
  }
  return 'system';
}

interface BufferedFrame {
  method: string;
  kind: string;
  role: AcpFrameRole;
  payload: string;
  createdAt: number;
}

/** The text a frame carries, for the collapsed row's badge. */
function frameText(update: Record<string, unknown>): string {
  const content = update.content;
  if (content && typeof content === 'object' && !Array.isArray(content)) {
    const text = (content as Record<string, unknown>).text;
    if (typeof text === 'string') return text;
  }
  if (typeof update.title === 'string') return update.title;
  if (typeof update.text === 'string') return update.text;
  return '';
}

/** One stored frame, in the shape the raw panel draws. */
function frameItem(
  row: { id: number; method: string; kind: string; role: string; payload: string; created_at: number },
  context: { modelId?: string; cwd?: string },
): RawMessageItem {
  let params: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(row.payload);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) params = parsed as Record<string, unknown>;
  } catch {
    params = {};
  }
  const update = params.update && typeof params.update === 'object' && !Array.isArray(params.update)
    ? (params.update as Record<string, unknown>)
    : {};
  const text = frameText(update);
  const usage = row.kind === 'usage_update' ? update : null;
  const used = usage && typeof usage.used === 'number' ? usage.used : 0;
  const size = usage && typeof usage.size === 'number' ? usage.size : 0;
  const cost = usage && usage.cost && typeof usage.cost === 'object' && typeof (usage.cost as Record<string, unknown>).amount === 'number'
    ? Number((usage.cost as Record<string, unknown>).amount)
    : 0;
  const timestamp = new Date(row.created_at).toLocaleString('en-US', {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const role = row.role === 'user' || row.role === 'assistant' ? row.role : 'system';
  return {
    id: `frame-${row.id}`,
    type: row.kind || row.method,
    badgeLabel: `${row.kind || row.method}${text ? `: ${text.slice(0, 60)}` : ''}`,
    tokenSummary: usage ? `${used.toLocaleString()} / ${size.toLocaleString()}` : '',
    timestamp,
    info: {
      id: `frame-${row.id}`,
      role,
      modelID: context.modelId ?? '',
      ...(context.cwd ? { path: { cwd: context.cwd, root: context.cwd } } : {}),
      cost,
      tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { write: 0, read: 0 } },
      ...(text ? { contentSnippet: text.slice(0, 200) } : {}),
      timestamp,
    },
    rawPayload: params,
  };
}

/**
 * One session's frame writer. `record` is called for every `session/update`
 * the live session receives; `flush` runs on the debounce and on dispose.
 */
export class AcpFrameRecorder {
  private readonly frames: BufferedFrame[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly sessionId: () => string) {}

  record(method: string, params: Record<string, unknown>): void {
    if (this.disposed) return;
    const update = params.update;
    const kind = update && typeof update === 'object' && !Array.isArray(update)
      && typeof (update as Record<string, unknown>).sessionUpdate === 'string'
      ? String((update as Record<string, unknown>).sessionUpdate)
      : '';
    this.frames.push({
      method,
      kind,
      role: frameRole(kind),
      payload: JSON.stringify(params),
      createdAt: Date.now(),
    });
    this.schedule();
  }

  async flush(): Promise<void> {
    if (this.frames.length === 0 || this.disposed) return;
    const sessionId = this.sessionId();
    if (!sessionId) return;
    const rows = this.frames.splice(0);
    try {
      const db = await getDb();
      await db.writeMany(
        'INSERT INTO acp_frames (session_id, method, kind, role, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        rows.map((row) => [sessionId, row.method, row.kind, row.role, row.payload, row.createdAt]),
      );
    } catch (error) {
      // A failed write is not a lost turn: the next frame retries, and the
      // transcript still holds the conversation.
      this.frames.unshift(...rows);
      console.error('[harness] could not record the ACP frames:', error);
    }
  }

  async dispose(): Promise<void> {
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.flush();
    this.disposed = true;
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

export interface AcpFramesPage {
  items: RawMessageItem[];
  total: number;
  filteredTotal: number;
}

/**
 * One page of a session's raw frames, newest first. `role` filters on the
 * denormalized column, so a page costs one indexed read rather than a parse of
 * every payload.
 */
export async function loadAcpFramesPage(
  sessionId: string,
  page: number,
  pageSize: number,
  role: 'all' | 'assistant' | 'user',
  context: { modelId?: string; cwd?: string } = {},
): Promise<AcpFramesPage> {
  const db = await getDb();
  const where = role === 'all' ? 'session_id = ?' : 'session_id = ? AND role = ?';
  const params: (string | number)[] = role === 'all' ? [sessionId] : [sessionId, role];
  const totalRow = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM acp_frames WHERE session_id = ?', [sessionId]);
  const filteredRow = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM acp_frames WHERE ${where}`, params);
  const rows = await db.all<{
    id: number;
    method: string;
    kind: string;
    role: string;
    payload: string;
    created_at: number;
  }>(
    `SELECT id, method, kind, role, payload, created_at FROM acp_frames
     WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  return {
    items: rows.map((row) => frameItem(row, context)),
    total: totalRow?.n ?? 0,
    filteredTotal: filteredRow?.n ?? 0,
  };
}
