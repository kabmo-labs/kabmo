/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The goal loop's own settings, read where the loop runs.
 *
 * They live in Kabmo settings blob beside the other Kabmo keys and
 * `autoSessionTitle`, and the server reads them straight from SQLite on every
 * decision — a goal can run for an hour across several turns, so a cached read
 * would keep an old choice alive for exactly the window the operator was
 * changing it in.
 *
 * Every value has a default and every read swallows its errors: a settings
 * lookup must never be the reason a turn's settle path throws.
 */

import { readSettingsJson } from '@/server/lib/db/settings-store';
import { getDb } from '@/server/db.server';

const SETTINGS_BLOB_KEY = 'kabmo_settings';

/** The auditor runs by default: a goal loop with no independent check is the
 *  behaviour this setting exists to avoid. */
const GOAL_AUDIT_DEFAULT = true;

export interface GoalSettings {
  /** Whether the auditor drives the loop at all. */
  auditEnabled: boolean;
  /** `provider/modelId` for the audit calls; empty = the session's own model. */
  auditModel: string;
}

export async function readGoalSettings(): Promise<GoalSettings> {
  try {
    const db = await getDb();
    const blob = await readSettingsJson<Record<string, unknown> | null>(db, SETTINGS_BLOB_KEY, null);
    const enabled = blob?.goalAuditEnabled;
    const model = blob?.goalAuditModel;
    return {
      auditEnabled: typeof enabled === 'boolean' ? enabled : GOAL_AUDIT_DEFAULT,
      auditModel: typeof model === 'string' ? model.trim() : '',
    };
  } catch {
    return { auditEnabled: GOAL_AUDIT_DEFAULT, auditModel: '' };
  }
}
