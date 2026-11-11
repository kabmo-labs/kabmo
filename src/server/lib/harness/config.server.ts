/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Per-harness config on the server: read it, write it, and turn it into the
 * launch shape a spawn needs.
 *
 * Stored one key per harness in `app_settings` (`omp_harness_config:<id>`), not
 * one blob for every harness. A blob would make two Kabmo instances writing
 * different harnesses clobber each other, which is the same defect
 * `session_ui_state` avoids by keying on the session; a key per harness makes
 * each write touch only its own row.
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { HARNESS_LAUNCH, type HarnessLaunch } from '@/server/lib/harness/launch-table';
import { customLaunch } from '@/server/lib/harness/custom.server';
import {
  harnessConfigKey,
  isHarnessConfigured,
  parseEnvLines,
  parseHarnessConfig,
  splitCommand,
  type HarnessConfig,
} from '@/shared/lib/harness/config';
import { harnessDescriptor, type HarnessId } from '@/shared/lib/harness/catalog';

/** Read one harness's config, always fully populated. */
export async function loadHarnessConfig(id: HarnessId): Promise<HarnessConfig> {
  const db = await getDb();
  return parseHarnessConfig(await readSettingsJson<unknown>(db, harnessConfigKey(id), null));
}

/** Persist one harness's config. An all-empty config DELETES the row so an
 *  install that resets a harness leaves no stale key behind. */
export async function saveHarnessConfig(id: HarnessId, config: HarnessConfig): Promise<void> {
  const db = await getDb();
  if (!isHarnessConfigured(config)) {
    await db.run('DELETE FROM app_settings WHERE key = ?', [harnessConfigKey(id)]);
    return;
  }
  await writeSettingsJson(db, harnessConfigKey(id), config);
}

/**
 * Does saving `next` over `previous` make the last probe stale?
 *
 * ONLY the launch line and the env: those are what a probe measured. A default
 * model, provider, thinking level or mode does not change what the agent
 * OFFERS — and treating every save as invalidating collapsed the provider/model
 * pickers back into free-text fields the moment a user stored a default
 * (measured).
 */
export function probeInvalidatedBy(previous: HarnessConfig, next: HarnessConfig): boolean {
  return previous.command !== next.command || previous.env !== next.env;
}

/** The launch shape an override produces from the table entry, or null when the
 *  config says nothing about launching. Pure, so the merge is testable. */
export function launchFromConfig(id: HarnessId, config: HarnessConfig): HarnessLaunch | null {
  const base = HARNESS_LAUNCH[id] ?? customLaunch(id);
  if (!base) return null;
  const command = splitCommand(config.command);
  const { env: parsedEnv, invalid } = parseEnvLines(config.env);
  if (invalid.length > 0) {
    // Surfaced as a spawn failure, not swallowed: a skipped line is an env var
    // the user believes is set.
    throw new Error(`Invalid env line${invalid.length === 1 ? '' : 's'}: ${invalid.join(', ')}`);
  }
  return {
    ...base,
    ...(command.length > 0 ? { command } : {}),
    ...(Object.keys(parsedEnv).length > 0
      ? { env: { ...(base.env ?? {}), ...parsedEnv } }
      : {}),
  };
}

/**
 * The launch line a spawn uses: the user's override merged over the table.
 *
 * Throws for a harness that cannot be launched at all (built-in, or absent from
 * the table): the spawn must fail loudly, because a harness with no line and no
 * override is a configuration error, not a session with no defaults.
 */
export function resolveLaunch(id: HarnessId, config: HarnessConfig): HarnessLaunch {
  if (harnessDescriptor(id)?.builtIn) {
    throw new Error(`${id} is built in and is not launched`);
  }
  if (!HARNESS_LAUNCH[id] && !customLaunch(id)) {
    throw new Error(`No launch command is configured for ${id}`);
  }
  const launch = launchFromConfig(id, config);
  if (!launch) throw new Error(`No launch command is configured for ${id}`);
  return launch;
}
