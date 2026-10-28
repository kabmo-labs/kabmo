/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A worktree refusal, carrying the code and the field it belongs to.
 *
 * The route answers `{ error, code, field }` from this, so the dialog can mark
 * the input that caused it instead of printing one sentence under the buttons.
 * Codes are stable; messages are for people.
 */

import type { WorktreeErrorCode, WorktreeFailure } from '@/shared/lib/workspace/worktree/types';

export class WorktreeError extends Error {
  readonly code: WorktreeErrorCode;
  readonly field?: WorktreeFailure['field'];
  readonly count?: number;

  constructor(code: WorktreeErrorCode, message: string, options: { field?: WorktreeFailure['field']; count?: number } = {}) {
    super(message);
    this.name = 'WorktreeError';
    this.code = code;
    this.field = options.field;
    this.count = options.count;
  }

  toFailure(): WorktreeFailure {
    return {
      code: this.code,
      message: this.message,
      ...(this.field ? { field: this.field } : {}),
      ...(this.count !== undefined ? { count: this.count } : {}),
    };
  }
}

/** Turn anything thrown into a failure, so an unexpected error is still typed. */
export function asWorktreeFailure(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeError) return error.toFailure();
  return { code: 'create_failed', message: error instanceof Error ? error.message : String(error) };
}