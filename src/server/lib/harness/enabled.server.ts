/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The disabled-harness list on the server.
 *
 * One `app_settings` row (`omp_harness_disabled`), read by `/api/harness` and
 * written by its `{ setEnabled: { id, enabled } }` action. The rules themselves
 * live in `@/shared/lib/harness/enabled`: which ids are switchable, that the list
 * stores the DISABLED ones, and that an unknown or retired id is dropped. This
 * module only persists the answer.
 *
 * A failed write is reported, never swallowed: a toggle that silently does
 * nothing is worse than one that refuses, because the user acts on a state the
 * server does not hold.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import {
  HARNESS_DISABLED_KEY,
  harnessSwitchable,
  parseDisabledHarnesses,
  withHarnessEnabled,
} from '@/shared/lib/harness/enabled';
import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';

/** Every harness id the user has switched OFF. */
export async function loadDisabledHarnesses(): Promise<string[]> {
  const db = await getDb();
  return parseDisabledHarnesses(await readSettingsJson<unknown>(db, HARNESS_DISABLED_KEY, []));
}

/**
 * Switch one harness and return the list as stored.
 *
 * Throws for the built-in transport and for an id this build does not know: a
 * request naming something no row draws must not invent an entry, because the
 * list is the only record of the user's intent.
 */
export async function saveHarnessEnabled(id: string, enabled: boolean): Promise<string[]> {
  if (!harnessDescriptor(id)) throw new Error(`Unknown harness: ${id}`);
  if (!harnessSwitchable(id)) {
    // The built-in transport is the path this app IS: a build with it off could
    // run no chat. Refused out loud rather than silently ignored.
    throw new Error(`${id} is built in and cannot be switched off`);
  }
  const db = await getDb();
  const next = withHarnessEnabled(id as HarnessId, enabled, await loadDisabledHarnesses());
  if (next.length === 0) {
    // An empty list means "everything", which is the default — so the row is
    // DELETED rather than written as `[]`, exactly as an all-empty harness config
    // does. A later catalog addition then arrives ON.
    await db.run('DELETE FROM app_settings WHERE key = ?', [HARNESS_DISABLED_KEY]);
    return [];
  }
  await writeSettingsJson(db, HARNESS_DISABLED_KEY, next);
  return next;
}
