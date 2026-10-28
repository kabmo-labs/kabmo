/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-only reader for the persisted tool-approval ("access") mode. Split
 * from access-mode.ts so the client bundle never pulls in `@/db.server`.
 */

import { getDb } from '@/server/db.server';
import { ACCESS_MODE_SETTING_KEY, DEFAULT_APPROVAL_MODE, isApprovalMode, type ApprovalMode } from '@/shared/lib/omp/config/access-mode';

/** Read the persisted access mode, defaulting on a missing row or any error.
 *  The generic settings writer stores non-object values with String(value), so
 *  the row holds the bare mode (`always-ask`, not `"always-ask"`) — validate it
 *  raw rather than assuming JSON.parse succeeds. */
export async function loadPersistedAccessMode(): Promise<ApprovalMode> {
  try {
    const db = await getDb();
    const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [ACCESS_MODE_SETTING_KEY]);
    const value: unknown = row?.value;
    return isApprovalMode(value) ? value : DEFAULT_APPROVAL_MODE;
  } catch {
    return DEFAULT_APPROVAL_MODE;
  }
}
