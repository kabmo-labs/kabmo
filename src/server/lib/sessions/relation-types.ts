/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The vocabulary of a session tree: its shape, its error codes, and the row
 * decoder. Split from the service so a route can name a refusal's code without
 * importing the write path.
 */

export const MAX_SESSION_DEPTH = 4;

export type SessionVisibility = 'visible' | 'hidden';
export type ParentNotifications = 'auto' | 'stuck' | 'off';
export type SessionOriginKind = 'fork';

export interface SessionRelation {
  sessionId: string;
  parentSessionId: string | null;
  lifecycleOwnerSessionId: string | null;
  sourceSessionId: string | null;
  originKind: SessionOriginKind | null;
  visibility: SessionVisibility;
  parentNotifications: ParentNotifications;
  depth: number;
  createdAt: number;
}

export type SessionRelationErrorCode =
  | 'invalid_argument'
  | 'self_parent'
  | 'cycle'
  | 'depth_exceeded'
  | 'fork_requires_source'
  | 'fork_is_not_a_child'
  | 'not_fork';

export class SessionRelationError extends Error {
  constructor(
    readonly code: SessionRelationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SessionRelationError';
  }
}

export interface RelationRow {
  session_id: string;
  parent_session_id: string | null;
  lifecycle_owner_session_id: string | null;
  source_session_id: string | null;
  origin_kind: string | null;
  visibility: string;
  parent_notifications: string;
  depth: number;
  created_at: number;
}

export function fromRow(row: RelationRow): SessionRelation {
  return {
    sessionId: row.session_id,
    parentSessionId: row.parent_session_id,
    lifecycleOwnerSessionId: row.lifecycle_owner_session_id,
    sourceSessionId: row.source_session_id,
    originKind: row.origin_kind === 'fork' ? 'fork' : null,
    visibility: row.visibility === 'hidden' ? 'hidden' : 'visible',
    parentNotifications:
      row.parent_notifications === 'stuck' || row.parent_notifications === 'off'
        ? row.parent_notifications
        : 'auto',
    depth: row.depth,
    createdAt: row.created_at,
  };
}
