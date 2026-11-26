/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two session-import actions behind `POST /api/harness`.
 *
 * Split from the catalog route so its dispatcher stays one branch per line and
 * these rules sit beside each other:
 *
 *  - a manual import is one spawn and reports the counts, or the agent's refusal
 *    verbatim — never a `success` with zero;
 *  - the auto-import switch is persisted FIRST and always succeeds; switching it
 *    ON also runs one import now, because a switch whose effect appears a
 *    quarter-hour later reads as broken. A failed import is reported beside the
 *    switch and does not undo it.
 */

import { json } from '@/server/lib/remix-compat';
import { importHarnessSessions } from '@/server/lib/harness/session-import.server';
import { saveAutoImportEnabled } from '@/server/lib/harness/auto-import.server';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';

export async function importSessionsAction(id: HarnessId): Promise<Response> {
  try {
    const result = await importHarnessSessions(id);
    return json({ importSessions: result });
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : 'Could not import this agent\'s sessions', code: 'session_import_failed' },
      { status: 400 },
    );
  }
}

export async function autoImportAction(id: HarnessId, enabled: boolean): Promise<Response> {
  try {
    await saveAutoImportEnabled(id, enabled);
    let result = null;
    let error = null;
    if (enabled) {
      try {
        result = await importHarnessSessions(id);
      } catch (cause) {
        error = cause instanceof Error ? cause.message : 'Could not import this agent\'s sessions';
      }
    }
    return json({
      autoImport: enabled,
      ...(result ? { importSessions: result } : {}),
      ...(error ? { error } : {}),
    });
  } catch (cause) {
    return json(
      { error: cause instanceof Error ? cause.message : 'Could not switch auto import' },
      { status: 400 },
    );
  }
}
