/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The subagent sessions one ACP parent owns.
 *
 * The subagents RFD makes a child a SESSION on the parent's connection: the
 * parent announces it with `subagent_update` (on the parent's stream, naming the
 * child in `sessionId`), and every later frame the child produces arrives with
 * the child's own `sessionId`. Before this module the session applied neither —
 * a child's frames were folded into the parent's transcript and a permission it
 * asked for was parked under the parent's id. That is the defect the gate in
 * `session-notifications.ts` now prevents.
 *
 * Association fields follow the RFD's PATCH semantics exactly (omitted =
 * unchanged, `null` = cleared), because a title reported once and a `cwd`
 * cleared later are two different updates of one record. Activity is the
 * child's own stream reduced to the last thing it said, which is what the card
 * shows; it is deliberately not a second transcript.
 */

import { acpContentText } from '@/server/lib/harness/acp/mapper';
import { isRecord } from '@/shared/lib/util/guards';
import type { AcpSubagentUpdate } from '@/server/lib/harness/acp/protocol';

/** One child session, as the parent has described it so far. */
export interface AcpSubagentRecord {
  /** The CHILD's ACP session id — the key every child frame carries. */
  sessionId: string;
  title?: string;
  description?: string;
  /** The parent allows this client to cancel the child's current work. */
  canCancel: boolean;
  cwd?: string;
  additionalDirectories?: string[];
  /** The child's own `state_update.state`; `unknown` until it reports one. */
  state: string;
  stopReason?: string;
  error?: string;
  /** The last text the child produced, capped. Empty until it says something. */
  activity: string;
  announcedAt: number;
  updatedAt: number;
}

/** What the card's badge says. Derived from the child's own state, never from
 *  the parent turn: a child outlives the turn that spawned it. */
export type SubagentCardStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'idle';

const ACTIVITY_LIMIT = 4_000;

/** The card status a record's state names. */
export function subagentCardStatus(record: AcpSubagentRecord): SubagentCardStatus {
  if (record.state === 'running' || record.state === 'requires_action' || record.state === 'unknown') {
    return 'running';
  }
  if (record.state !== 'idle') return 'running';
  if (record.stopReason === 'cancelled') return 'cancelled';
  if (record.stopReason === 'error' || record.error) return 'failed';
  if (record.stopReason) return 'completed';
  return 'idle';
}

/** Whether the child's work has ended (its card must stop spinning). */
export function subagentFinished(record: AcpSubagentRecord): boolean {
  return record.state === 'idle';
}

export class AcpSubagents {
  private readonly records = new Map<string, AcpSubagentRecord>();

  /** Apply one `subagent_update`; null when it names no child. */
  apply(raw: Record<string, unknown>): AcpSubagentRecord | null {
    const update = raw as unknown as AcpSubagentUpdate;
    const sessionId = (typeof update.sessionId === 'string' ? update.sessionId : '');
    if (!sessionId) return null;
    const now = Date.now();
    const record = this.records.get(sessionId) ?? {
      sessionId,
      canCancel: false,
      state: 'unknown',
      activity: '',
      announcedAt: now,
      updatedAt: now,
    };
    if ('title' in update) record.title = typeof update.title === 'string' && update.title ? update.title : undefined;
    if ('description' in update) record.description = typeof update.description === 'string' && update.description ? update.description : undefined;
    if ('cwd' in update) record.cwd = typeof update.cwd === 'string' && update.cwd ? update.cwd : undefined;
    if ('additionalDirectories' in update) {
      const dirs = Array.isArray(update.additionalDirectories)
        ? update.additionalDirectories.filter((entry): entry is string => typeof entry === 'string')
        : [];
      record.additionalDirectories = dirs.length > 0 ? dirs : undefined;
    }
    if ('capabilities' in update) {
      // Capabilities are replaced as a whole: `{cancel: null}` disables it.
      record.canCancel = isRecord(update.capabilities) && update.capabilities.cancel != null;
    }
    if ('state' in update) this.applyState(record, update.state);
    record.updatedAt = now;
    this.records.set(sessionId, record);
    return record;
  }

  /** Fold one of the CHILD's own frames into its record. Undefined when the
   *  id names no known child — the caller drops that traffic. */
  absorb(sessionId: string, update: Record<string, unknown>): AcpSubagentRecord | undefined {
    const record = this.records.get(sessionId);
    if (!record) return undefined;
    const kind = typeof update.sessionUpdate === 'string' ? update.sessionUpdate : '';
    if (kind === 'state_update') {
      this.applyState(record, update);
    } else if (kind === 'agent_message_chunk' || kind === 'agent_message') {
      const text = acpContentText(update.content);
      if (text) {
        record.activity = kind === 'agent_message'
          ? text.slice(-ACTIVITY_LIMIT)
          : `${record.activity}${text}`.slice(-ACTIVITY_LIMIT);
      }
    } else if (kind === 'session_info_update' && typeof update.title === 'string' && update.title) {
      record.title = update.title;
    }
    record.updatedAt = Date.now();
    return record;
  }

  /** Mark every unfinished child cancelled — the parent is going away and no
   *  later frame will ever report their outcome. */
  finishAll(reason = 'The parent session ended'): AcpSubagentRecord[] {
    const changed: AcpSubagentRecord[] = [];
    for (const record of this.records.values()) {
      if (record.state === 'idle') continue;
      record.state = 'idle';
      record.stopReason = 'cancelled';
      record.error = reason;
      record.updatedAt = Date.now();
      changed.push(record);
    }
    return changed;
  }

  get(sessionId: string): AcpSubagentRecord | undefined {
    return this.records.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  /** Whether any child is still working. A parent that reclaims its child
   *  mid-run takes work the operator is waiting for. */
  anyRunning(): boolean {
    for (const record of this.records.values()) if (record.state !== 'idle') return true;
    return false;
  }

  list(): AcpSubagentRecord[] {
    return [...this.records.values()].sort((left, right) => left.announcedAt - right.announcedAt);
  }

  clear(): void {
    this.records.clear();
  }

  private applyState(record: AcpSubagentRecord, state: unknown): void {
    if (state === null || state === undefined) {
      record.state = 'unknown';
      record.stopReason = undefined;
      record.error = undefined;
      return;
    }
    if (!isRecord(state)) return;
    record.state = typeof state.state === 'string' && state.state ? state.state : 'unknown';
    record.stopReason = typeof state.stopReason === 'string' && state.stopReason ? state.stopReason : undefined;
    const error = isRecord(state.error) && typeof state.error.message === 'string' && state.error.message
      ? state.error.message
      : undefined;
    record.error = error;
  }
}
