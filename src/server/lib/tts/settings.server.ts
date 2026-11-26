/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side view of the speech preference: the stored config (from the
 * `kabmo_settings` blob) plus the hosted engines' API keys (a 0600 file).
 *
 * Two sources, deliberately. The config is a normal preference — the client
 * edits it through `/api/settings` and reads it from the bootstrap. A key is a
 * credential, and the bootstrap ships the whole `app_settings` map to the
 * browser, so the keys live outside that table. `redactedTtsSettings` is the
 * only shape a route may return.
 */

import fs from 'fs/promises';
import { getDb } from '@/server/db.server';
import { readAllSettingsJson } from '@kabmo-labs/kabmo-settings-store';
import { writeFileAtomic } from '@kabmo-labs/kabmo-fs-config/atomic-write';
import { getTtsSecretPath } from '@kabmo-labs/kabmo-paths/paths';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { isTtsEngine, TTS_ENGINES, type TtsEngine } from '@/shared/lib/tts/engines';
import { normalizeTtsConfig, type TtsConfig } from '@/shared/lib/tts/settings';

/** Engines whose key this install can hold. */
export const HOSTED_TTS_ENGINES = TTS_ENGINES.filter((engine) => engine.needsKey).map((engine) => engine.id);

/** Engines that run on this machine and therefore hold no credential. */
export type LocalTtsEngine = Extract<TtsEngine, 'omp' | 'local'>;
export type HostedTtsEngine = Exclude<TtsEngine, LocalTtsEngine>;
export type TtsKeyPresence = Record<string, boolean>;

interface TtsSecretFile {
  version: 1;
  keys: Partial<Record<HostedTtsEngine, string>>;
  updatedAt?: string;
}

/** The stored preference, normalised. Never contains a key. */
export async function readTtsConfig(): Promise<TtsConfig> {
  const db = await getDb();
  const settings = await readAllSettingsJson(db);
  const blob = readSettingsBlob(settings as Record<string, unknown>);
  return normalizeTtsConfig(blob.tts);
}

async function readSecretFile(): Promise<TtsSecretFile> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(getTtsSecretPath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return { version: 1, keys: {} };
    const keys = (parsed as Record<string, unknown>).keys;
    if (typeof keys !== 'object' || keys === null) return { version: 1, keys: {} };
    const clean: Partial<Record<HostedTtsEngine, string>> = {};
    for (const [engine, value] of Object.entries(keys as Record<string, unknown>)) {
      if (isTtsEngine(engine) && engine !== 'omp' && engine !== 'local'
        && typeof value === 'string' && value.trim()) {
        clean[engine] = value.trim();
      }
    }
    return { version: 1, keys: clean };
  } catch {
    // A malformed or unreadable file is "no key": the caller then reports the
    // engine as unconfigured, which is the actionable state.
    return { version: 1, keys: {} };
  }
}

/** One engine's key, or null. A local engine never has one. */
export async function readTtsApiKey(engine: TtsEngine): Promise<string | null> {
  if (engine === 'omp' || engine === 'local') return null;
  const file = await readSecretFile();
  return file.keys[engine] ?? null;
}

/** Save (or clear, with null) one engine's key without touching the others. */
export async function writeTtsApiKey(engine: HostedTtsEngine, apiKey: string | null): Promise<void> {
  const file = await readSecretFile();
  const keys = { ...file.keys };
  if (apiKey === null) delete keys[engine];
  else keys[engine] = apiKey;
  if (Object.keys(keys).length === 0) {
    await fs.rm(getTtsSecretPath(), { force: true });
    return;
  }
  const body = JSON.stringify({ version: 1, keys, updatedAt: new Date().toISOString() }, null, 2);
  await writeFileAtomic(getTtsSecretPath(), `${body}\n`, { createMode: 0o600 });
}

/** Which engines have a key, without ever returning one. */
export async function readTtsKeyPresence(): Promise<TtsKeyPresence> {
  const file = await readSecretFile();
  const presence: TtsKeyPresence = {};
  for (const engine of HOSTED_TTS_ENGINES) presence[engine] = Boolean(file.keys[engine as HostedTtsEngine]);
  return presence;
}

/** What a route may send: the preference plus whether each key exists. */
export interface RedactedTtsSettings extends TtsConfig {
  hasKeys: TtsKeyPresence;
}

export async function redactedTtsSettings(): Promise<RedactedTtsSettings> {
  const [config, hasKeys] = await Promise.all([readTtsConfig(), readTtsKeyPresence()]);
  return { ...config, hasKeys };
}
