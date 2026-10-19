/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The JSONL surgery and overlay pruning behind the in-place rewind endpoint,
 * split from the route so both can be exercised without a live session file.
 *
 * A rewind truncates the session file back to just before a USER TURN. Two
 * record shapes carry one, and both must be accepted:
 *
 *  - `type: "message"` with `message.role: "user"` — an ordinary prompt;
 *  - `type: "custom_message"` with `customType: "skill-prompt"` — omp expands
 *    `/skill:<name>` into a custom record and writes NO user message for it, so
 *    a skill turn had no valid cut point at all: the route answered
 *    `entry_not_found` (400) and the Undo button did nothing.
 *
 * A cut point is not always IN the file, either. A builtin command (`/usage`,
 * `/compact`, `/context`) writes no entry at all, so the timeline row the user
 * clicks exists only in Kabmo DB and carries a client-side id
 * (`msg-…-user`). The row is positioned by its own clock, so a cut named by
 * such an id resolves to the first FILE turn at or after it — and the rows the
 * cut removed are reported back so the overlay can drop them too. Missing that
 * second half is what resurrected an undone turn on the next reload.
 */

import { isRecord } from '@/shared/lib/util/guards';

/** omp's custom record for an expanded `/skill:<name>` invocation. */
const SKILL_PROMPT_CUSTOM_TYPE = 'skill-prompt';

/** Header records whose LAST value still describes the session after a cut. */
const CARRIED_HEADER_TYPES = ['model_change', 'thinking_level_change'] as const;

/** What the caller wants to rewind to. */
export interface RewindCut {
  /** The row id the caller asked to rewind to. */
  entryId: string;
  /**
   * The row's own clock (epoch ms), used when the file carries no entry with
   * that id. Only a row the caller read from the overlay has one.
   */
  startedAt?: number;
}

/** The rewritten body plus what the cut invalidated. */
export interface TruncatedSession {
  /** The new JSONL body. */
  body: string;
  /**
   * Clock at or after which stored overlay rows are removed.
   *
   * It is the REQUESTED row's own clock when the file could not name it — a
   * builtin command's row — because "undo this turn" removes everything after
   * that turn, including other command rows sitting between it and the next
   * file entry. When the file DID name the turn, its own clock is the boundary.
   */
  overlayCutClock?: number;
  /**
   * Ids of the FILE turns the cut removed. A stored row carrying one of these
   * no longer survives in the transcript and must not be merged back.
   */
  droppedEntryIds: string[];
}

/** A stored overlay row, as much of it as the prune needs. */
export interface StoredOverlayRow {
  id?: string;
  role?: string;
  content?: string;
  startedAt?: number;
}

/**
 * Whether a parsed JSONL record is a turn a rewind may cut at. The rule is a
 * pair of shapes rather than a field read, which is why it is named.
 */
export function isRewindCutPoint(record: Record<string, unknown> | null): boolean {
  if (!record) return false;
  if (record.type === 'message') {
    const message = record.message;
    return isRecord(message) && message.role === 'user';
  }
  return record.type === 'custom_message' && record.customType === SKILL_PROMPT_CUSTOM_TYPE;
}

/** When the file says the entry happened, in epoch ms. */
function recordClock(record: Record<string, unknown>): number | undefined {
  const raw = record.timestamp ?? (isRecord(record.message) ? record.message.timestamp : undefined);
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Index the cut lands on: the entry named by id, or — when the file does not
 * carry that id — the first turn at or after the caller's clock. A clock past
 * every turn cuts at the end, which is a legitimate "undo a trailing command"
 * rather than a failure.
 */
function resolveCutIndex(
  records: Array<Record<string, unknown> | null>,
  cut: RewindCut,
): number | undefined {
  const exact = records.findIndex((r) => r?.id === cut.entryId);
  if (exact !== -1) return isRewindCutPoint(records[exact]) ? exact : undefined;
  if (typeof cut.startedAt !== 'number' || !Number.isFinite(cut.startedAt)) return undefined;

  const after = records.findIndex((r) => {
    if (!isRewindCutPoint(r)) return false;
    const clock = r ? recordClock(r) : undefined;
    return clock !== undefined && clock >= cut.startedAt!;
  });
  if (after !== -1) return after;
  // Every turn predates the row being undone: nothing to remove from the file.
  return records.length;
}

/**
 * Build the truncated body: entries at/after the cut turn are dropped; header
 * records and everything before it survive. Returns null when the cut cannot be
 * resolved at all (an unknown id with no clock, or an id naming a non-turn).
 */
export function truncateSessionBody(body: string, cut: RewindCut): TruncatedSession | null {
  const records: Array<Record<string, unknown> | null> = body.split('\n').map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return null;
    }
    return isRecord(parsed) ? parsed : null;
  });

  const cutIndex = resolveCutIndex(records, cut);
  if (cutIndex === undefined) return null;

  const kept = records.slice(0, cutIndex);
  const outLines = kept
    .filter((r): r is Record<string, unknown> => Boolean(r))
    .map((r) => JSON.stringify(r));
  // Header records written after the cut point (model/thinking changes during
  // the abandoned turns) still describe the session's latest state — keep the
  // last of each so a respawn resumes with the same model/level.
  for (const type of CARRIED_HEADER_TYPES) {
    const last = records
      .slice(cutIndex)
      .filter((r): r is Record<string, unknown> => r?.type === type)
      .pop();
    if (last) outLines.push(JSON.stringify(last));
  }

  const droppedEntryIds = records
    .slice(cutIndex)
    .filter((r): r is Record<string, unknown> => isRewindCutPoint(r))
    .map((r) => (typeof r.id === 'string' ? r.id : ''))
    .filter((id) => id !== '');

  const cutRecord = records[cutIndex];
  // A cut the file could not name is placed by the requested row's clock, and
  // the boundary for stored rows is that same clock — not the next file turn's.
  // Using the file turn's clock kept every command row between the two alive,
  // so undoing one `/usage` left the next one standing after a reload.
  const resolvedByClock = cutRecord?.id !== cut.entryId;
  return {
    body: `${outLines.join('\n')}\n`,
    overlayCutClock: resolvedByClock ? cut.startedAt : (cutRecord ? recordClock(cutRecord) : undefined),
    droppedEntryIds,
  };
}

/**
 * Drop the stored overlay rows the cut invalidated, and ONLY those.
 *
 * The rule is per row, because the overlay holds two different things. A row
 * named by the file (`droppedEntryIds`) is gone. A client-side row — a builtin
 * command's turn — is positioned by its own clock, so it survives only while it
 * sits BEFORE the cut; comparing clocks is what keeps the `/usage` turns above
 * the cut instead of deleting them, and it is also what removes the ones below
 * it so a reload cannot resurrect an undone turn.
 *
 * A legacy row with no clock keeps the older text-relatedness test: without a
 * clock there is no way to place it, and every row written today carries one.
 */
export function pruneStoredAfterCut(
  stored: StoredOverlayRow[],
  cut: {
    /** The row the user asked to rewind to; always removed. */
    requestedId: string;
    /** Ids of file turns the cut removed. */
    droppedEntryIds: string[];
    /** Boundary clock; stored rows at or after it are removed. */
    cutClock?: number;
    /** Text of the user turns still present in the truncated file. */
    keptUserTexts: string[];
    /** Whether `a` and `b` are the same request (omp rewrites prompts). */
    relates: (a: string, b: string) => boolean;
  },
): StoredOverlayRow[] {
  const dropped = new Set(cut.droppedEntryIds);
  return stored.filter((row) => {
    // The requested row is a user TURN (every footer action names one), so the
    // id alone never authorizes dropping an assistant or notice row.
    if (row?.id && row.id === cut.requestedId && row.role === 'user') return false;
    if (row?.id && dropped.has(row.id)) return false;
    if (row?.role !== 'user' || typeof row.content !== 'string') return true;
    if (typeof row.startedAt === 'number' && cut.cutClock !== undefined) {
      return row.startedAt < cut.cutClock;
    }
    return cut.keptUserTexts.some((text) => cut.relates(text, row.content!));
  });
}

/** Plain text of a stored user-message content (string or text blocks). */
export function userEntryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (isRecord(block) && block.type === 'text' ? String(block.text ?? '') : ''))
    .join('');
}

/** User turns still present in a JSONL body, as plain text. */
export function survivingUserTexts(body: string): string[] {
  return body
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        return isRecord(parsed) ? parsed : null;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => isRewindCutPoint(r))
    .map((r) => {
      const message = r.message;
      return userEntryText(isRecord(message) ? message.content : r.content);
    });
}
