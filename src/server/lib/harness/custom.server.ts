/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Harnesses the user adds, on top of the ones this build ships.
 *
 * The ACP transport is already harness-agnostic: a launch line is a command
 * vector, the handshake is generic, and the settings page reads `/api/harness`
 * rather than a static list. What was missing was a place to PUT a definition
 * and a registry the synchronous call sites (`harnessDescriptor`,
 * `resolveLaunch`, `commandAvailable`) can read.
 *
 * The registry is process-wide and anchored on `globalThis` for the reason every
 * other one here is: `bun --hot` re-evaluates this module while the descriptors
 * it registered are still in use, and a module-level map would come back empty.
 *
 * A custom harness is ACP by definition — the add form offers no other
 * transport — so its descriptor is `transport: 'acp'`, `glyph: 'custom'`, and
 * its launch line is the command the user typed. Nothing here spawns anything;
 * the existing probe and spawn paths do, once `resolveLaunch` can see the row.
 */

import { getDb } from '@/server/db.server';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import { HARNESS_DISABLED_KEY } from '@/shared/lib/harness/enabled';
import { harnessConfigKey, parseEnvLines, splitCommand } from '@/shared/lib/harness/config';
import {
  HARNESS_CATALOG,
  isBuiltinHarness,
  registerHarnessDescriptors,
  type HarnessDescriptor,
} from '@/shared/lib/harness/catalog';
import type { HarnessLaunch } from '@/server/lib/harness/launch-table';

/** One user-added harness, as stored. */
export interface CustomHarness {
  id: string;
  label: string;
  /** The letter the UI draws when there is no vendor mark. */
  initial: string;
  /** Space-separated launch command, e.g. `npx -y my-agent acp`. */
  command: string;
  /** `KEY=VALUE` lines, one per line. */
  env: string;
  note: string;
}

export interface CustomHarnessInput {
  id?: unknown;
  label?: unknown;
  initial?: unknown;
  command?: unknown;
  env?: unknown;
  note?: unknown;
}

/** Lowercase, digits and dashes: the id reaches a settings key and a URL. */
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
const MAX_LABEL = 40;
const MAX_NOTE = 200;

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCustomHarnesses: Map<string, CustomHarness> | undefined;
  // eslint-disable-next-line no-var
  var __kabmoCustomHarnessesLoaded: boolean | undefined;
}

function registry(): Map<string, CustomHarness> {
  return (globalThis.__kabmoCustomHarnesses ??= new Map());
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate one definition.
 *
 * Refuses by name rather than coercing: a command that is empty, an id that
 * collides with a built-in, or an env line that is not `KEY=VALUE` would
 * otherwise be stored and then fail at spawn with a message about something
 * else.
 */
export function validateCustomHarness(
  input: CustomHarnessInput,
): { ok: true; value: CustomHarness } | { ok: false; error: string } {
  const id = text(input.id).toLowerCase();
  if (!ID_PATTERN.test(id)) {
    return { ok: false, error: 'id must be 1–32 lowercase letters, digits or dashes' };
  }
  if (isBuiltinHarness(id) || (HARNESS_CATALOG as Record<string, HarnessDescriptor | undefined>)[id]) {
    return { ok: false, error: `"${id}" is a harness this build already ships` };
  }
  const label = text(input.label) || id;
  if (label.length > MAX_LABEL) return { ok: false, error: `label must be at most ${MAX_LABEL} characters` };
  const command = text(input.command);
  if (splitCommand(command).length === 0) return { ok: false, error: 'command is required' };
  const env = typeof input.env === 'string' ? input.env : '';
  const parsedEnv = parseEnvLines(env);
  if (parsedEnv.invalid.length > 0) {
    return { ok: false, error: `invalid env line${parsedEnv.invalid.length === 1 ? '' : 's'}: ${parsedEnv.invalid.join(', ')}` };
  }
  const note = text(input.note);
  if (note.length > MAX_NOTE) return { ok: false, error: `note must be at most ${MAX_NOTE} characters` };
  const initial = (text(input.initial) || label.charAt(0) || '?').slice(0, 2);
  return { ok: true, value: { id, label, initial, command, env, note } };
}

/** The descriptor the shared catalog registers for one row. */
function descriptorOf(harness: CustomHarness): HarnessDescriptor {
  return { id: harness.id, label: harness.label, initial: harness.initial, transport: 'acp', glyph: 'custom' };
}

/** Re-read every row and publish it to the shared catalog. */
export async function refreshCustomHarnesses(): Promise<void> {
  const db = await getDb();
  const rows = await db.all<{
    id: string;
    label: string;
    initial: string;
    command: string;
    env: string;
    note: string;
  }>('SELECT id, label, initial, command, env, note FROM custom_harnesses ORDER BY created_at ASC');
  const next = new Map<string, CustomHarness>();
  for (const row of rows) next.set(row.id, { ...row });
  globalThis.__kabmoCustomHarnesses = next;
  globalThis.__kabmoCustomHarnessesLoaded = true;
  registerHarnessDescriptors([...next.values()].map(descriptorOf));
}

/** Load once per process; a write calls `refreshCustomHarnesses` itself. */
export async function ensureCustomHarnesses(): Promise<void> {
  if (globalThis.__kabmoCustomHarnessesLoaded) return;
  await refreshCustomHarnesses();
}

/** Every custom harness, in creation order. */
export async function listCustomHarnesses(): Promise<CustomHarness[]> {
  await ensureCustomHarnesses();
  return [...registry().values()];
}

/** One custom harness, or undefined. Synchronous: the launch path needs it. */
export function customHarness(id: string | null | undefined): CustomHarness | undefined {
  return id ? registry().get(id) : undefined;
}

/** The launch line a custom harness contributes, or undefined. */
export function customLaunch(id: string | null | undefined): HarnessLaunch | undefined {
  const harness = customHarness(id);
  if (!harness) return undefined;
  const { env } = parseEnvLines(harness.env);
  return {
    id: harness.id,
    command: splitCommand(harness.command),
    ...(Object.keys(env).length > 0 ? { env } : {}),
    note: harness.note || 'A harness you added.',
  };
}

/** Create or replace one definition, then republish the catalog. */
export async function saveCustomHarness(input: CustomHarnessInput): Promise<CustomHarness> {
  const checked = validateCustomHarness(input);
  if (!checked.ok) throw new Error(checked.error);
  const db = await getDb();
  await db.run(
    `INSERT INTO custom_harnesses (id, label, initial, command, env, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       label = excluded.label,
       initial = excluded.initial,
       command = excluded.command,
       env = excluded.env,
       note = excluded.note`,
    [checked.value.id, checked.value.label, checked.value.initial, checked.value.command, checked.value.env, checked.value.note, Date.now()],
  );
  // The launch line may have changed, so the last probe no longer describes it.
  await forgetProbe(checked.value.id);
  await refreshCustomHarnesses();
  return checked.value;
}

/**
 * Remove one definition and every per-harness row it owned.
 *
 * Sessions are NOT deleted: a chat that ran on this harness keeps its
 * `harness_sessions` row, and `resolveSessionRef` reports the id so the resume
 * path can refuse in words ("this harness is no longer registered") instead of
 * silently pretending the chat ran on omp.
 */
export async function removeCustomHarness(id: string): Promise<void> {
  const db = await getDb();
  await db.run('DELETE FROM custom_harnesses WHERE id = ?', [id]);
  await db.run('DELETE FROM app_settings WHERE key = ?', [harnessConfigKey(id)]);
  await db.run('DELETE FROM harness_probes WHERE harness = ?', [id]);
  await forgetProbe(id);
  const disabled = await readSettingsJson<unknown>(db, HARNESS_DISABLED_KEY, []);
  if (Array.isArray(disabled) && disabled.includes(id)) {
    const next = disabled.filter((entry) => entry !== id);
    if (next.length === 0) await db.run('DELETE FROM app_settings WHERE key = ?', [HARNESS_DISABLED_KEY]);
    else await writeSettingsJson(db, HARNESS_DISABLED_KEY, next);
  }
  await refreshCustomHarnesses();
}
