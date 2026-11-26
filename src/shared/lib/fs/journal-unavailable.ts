/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The diff tab's refusal for a journal pair the blob store cannot supply.
 *
 * Three different facts read as one "unknown" on the wire, and naming the
 * wrong one sends the reader looking for a size problem that does not exist:
 * a snapshot that lost the race, a stored blob that is now gone, and a file
 * over the store's cap. The cap is the store's, not a fixed 8 MB — omp stops
 * at 8 MB while Kabmo's journal stops at 32 MB.
 */

import { formatToolBytes } from '@/shared/lib/chat/tool/labels';
import type { SessionChangeUnavailableReason } from '@kabmo-labs/kabmo-omp-contracts/session-changes';

export interface JournalUnavailable {
  reason?: SessionChangeUnavailableReason;
  limitBytes?: number;
}

export function journalUnavailableMessage({ reason, limitBytes }: JournalUnavailable): string {
  if (reason === 'snapshot-race') {
    return 'The journal’s pre-write snapshot missed this file, so the two sides are unknown.';
  }
  if (reason === 'unreadable') {
    return 'The journal’s copy of this file could not be read back, so the two sides are unknown.';
  }
  if (limitBytes !== undefined) {
    return `The journal did not store this file’s content (over ${formatToolBytes(limitBytes)}), so the two sides are unknown.`;
  }
  return 'The journal did not store this file’s content, so the two sides are unknown.';
}
