/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Recovering a session whose RECORDED model no longer exists.
 *
 * ## The failure
 *
 * `omp --resume <file>` restores the model the session's last `model_change`
 * entry names. When that model is no longer in the registry — a provider the
 * user disconnected, a model removed from `models.yml`, a provider added to
 * `disabledProviders` — omp does NOT fall back: the child exits(1) with
 * `error: Could not restore model <provider>/<id>`.
 *
 * Measured on this machine (omp 18.13.1): a session whose last `model_change`
 * was `deepseek/deepseek-flash` (a provider that is not in the registry at all)
 * made every later command to that session fail with that error — the `set_model`
 * a model change posts, the `get_state` warmup, and the `prompt` alike. The
 * user-visible shape is "I changed the model, then sent a prompt to the
 * previous session, and the prompt never arrived": the send never reached a
 * model because the child could not even start.
 *
 * ## The recovery
 *
 * The session is RESPAWNED with `--model <a model omp can resolve>`. The
 * command that triggered the spawn then runs against the new child, so the
 * user's own `set_model` still lands and the pick they made is what the
 * session ends up running.
 *
 * The respawn happens ONLY when the child died for this reason: a healthy
 * session is spawned exactly as before, and no catalog is read (the listing
 * costs ~1.3 s).
 *
 * ## Why the CLI listing is the oracle
 *
 * The set of models omp can actually resolve is its OWN listing
 * (`omp models --json --kind all`), not the chat picker: the picker filters
 * `disabledProviders` and per-model hides out, so a model the picker once
 * offered can be absent from it while omp still resolves it, and a model the
 * picker never offered (a `kind` other than `chat`) can still be what the
 * transcript names. The listing is the union of everything omp can run, which
 * is exactly the question "can this session's model be restored?".
 */

import { getDb } from '@/server/db.server';
import { readSettingsJson } from '@/server/lib/db/settings-store';
import { childEnv } from '@/server/lib/fs/child-env';
import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { readModelRoles } from '@/server/lib/omp/config/roles';
import type { SelectedModel } from '@/shared/types/models';

/** How long the CLI listing stays usable. */
const CATALOG_TTL_MS = 60_000;
const CATALOG_TIMEOUT_MS = 30_000;

/** The app_settings row the model dropdown writes on every pick. */
const SELECTED_MODEL_KEY = 'omp_selected_model';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoResolvableModels: { at: number; selectors: Set<string> } | undefined;
}

/** `provider/id` → the selector omp's own listing reports. */
function selectorOf(model: SelectedModel): string {
  return `${model.provider}/${model.modelId}`;
}

/**
 * Every model omp can resolve, as `provider/id` selectors.
 *
 * `null` when the listing could not be read — the caller then has no basis for
 * a replacement and the spawn failure is reported as it is.
 */
async function readResolvableSelectors(): Promise<Set<string> | null> {
  const cached = globalThis.__kabmoResolvableModels;
  if (cached && cached.at + CATALOG_TTL_MS > Date.now()) return cached.selectors;

  const bin = resolveOmpBin();
  if (!bin) return null;
  try {
    const proc = Bun.spawn({
      env: childEnv(),
      cmd: [bin, 'models', '--json', '--kind', 'all'],
      stdout: 'pipe',
      stderr: 'ignore',
      timeout: CATALOG_TIMEOUT_MS,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    });
    const stdout = await new Response(proc.stdout).text();
    if ((await proc.exited) !== 0) return null;
    const parsed = JSON.parse(stdout) as { models?: unknown };
    if (!Array.isArray(parsed.models)) return null;
    const selectors = new Set<string>();
    for (const entry of parsed.models) {
      if (typeof entry !== 'object' || entry === null) continue;
      const row = entry as { provider?: unknown; id?: unknown };
      if (typeof row.provider !== 'string' || typeof row.id !== 'string') continue;
      selectors.add(`${row.provider}/${row.id}`);
    }
    globalThis.__kabmoResolvableModels = { at: Date.now(), selectors };
    return selectors;
  } catch {
    return null;
  }
}

/** Drop the cached listing (a provider or model changed under us). */
export function invalidateResolvableModels(): void {
  globalThis.__kabmoResolvableModels = undefined;
}

/**
 * True when a child died because omp could not restore the session's model.
 *
 * The message is omp's own (`error: Could not restore model <provider>/<id>`),
 * carried in the process's stderr tail by the exit error.
 */
export function isUnrestorableModelFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /Could not restore model\s+\S+/.test(message);
}

/** The model the model dropdown last recorded, as a `provider`/`modelId` pair. */
async function readPersistedPick(): Promise<SelectedModel | null> {
  try {
    const db = await getDb();
    const stored = await readSettingsJson<unknown>(db, SELECTED_MODEL_KEY, null);
    if (typeof stored !== 'object' || stored === null) return null;
    const row = stored as { provider?: unknown; modelId?: unknown; id?: unknown };
    const provider = typeof row.provider === 'string' ? row.provider : '';
    const modelId = typeof row.modelId === 'string'
      ? row.modelId
      : typeof row.id === 'string' ? row.id : '';
    if (!provider || !modelId) return null;
    return { provider, modelId };
  } catch {
    return null;
  }
}

/** The registry's default model (`config.yml`'s `modelRoles.default`). */
async function readRegistryDefault(): Promise<SelectedModel | null> {
  try {
    const { roles } = await readModelRoles();
    const selector = roles.default;
    if (!selector) return null;
    const slash = selector.indexOf('/');
    if (slash <= 0 || slash === selector.length - 1) return null;
    return { provider: selector.slice(0, slash), modelId: selector.slice(slash + 1) };
  } catch {
    return null;
  }
}

/**
 * A model omp can resolve, to RESUME a session with.
 *
 * The order is the caller's own candidate first (the model the command being
 * dispatched asks for — the operator's pick in the composer), then the model
 * the dropdown last recorded, then the registry's default. The session's
 * RECORDED model is deliberately not a candidate: it is the one that could not
 * be restored, and offering it again would repeat the same failure.
 */
export async function resolveResumableModel(
  preferred?: SelectedModel | null,
): Promise<SelectedModel | null> {
  const selectors = await readResolvableSelectors();
  // The listing could not be read: there is no basis for a replacement, and a
  // guess would swap the session's model for an arbitrary one.
  if (!selectors) return null;

  for (const candidate of [preferred ?? null, await readPersistedPick(), await readRegistryDefault()]) {
    if (!candidate) continue;
    if (selectors.has(selectorOf(candidate))) return candidate;
  }
  return null;
}
