/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Server-side view of the dictation preference: the stored config (from the
 * `kabmo_settings` blob) plus the API key (from a 0600 file).
 *
 * Two sources, deliberately. The config is a normal preference — the client
 * edits it through `/api/settings` and reads it from the bootstrap. The key is a
 * credential, and the bootstrap ships the whole `app_settings` map to the
 * browser, so it lives outside that table. `redactedDictationSettings` is the
 * only shape a route may return.
 */

import fs from 'fs/promises';
import { getDb } from '@/server/db.server';
import { readAllSettingsJson } from '@/server/lib/db/settings-store';
import { writeFileAtomic } from '@kabmo-labs/kabmo-fs-config/atomic-write';
import { getDictationSecretPath } from '@/server/lib/lifecycle/paths';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import {
  normalizeDictationConfig,
  type DictationConfig,
} from '@/shared/lib/dictation/settings';

/** The stored preference, normalised. Never contains the key. */
export async function readDictationConfig(): Promise<DictationConfig> {
  const db = await getDb();
  const settings = await readAllSettingsJson(db);
  const blob = readSettingsBlob(settings as Record<string, unknown>);
  return normalizeDictationConfig(blob.dictation);
}

/**
 * The stored API key, or null.
 *
 * A malformed or unreadable file is "no key": the caller then reports the
 * engine as unconfigured, which is the actionable state, instead of attempting
 * a request with a half-read credential.
 */
export async function readDictationApiKey(): Promise<string | null> {
  try {
    const raw = await fs.readFile(getDictationSecretPath(), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const apiKey = (parsed as Record<string, unknown>).apiKey;
    return typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
  } catch {
    return null;
  }
}

/** Persist the key (0600), or delete the file when `apiKey` is null. */
export async function writeDictationApiKey(apiKey: string | null): Promise<void> {
  const path = getDictationSecretPath();
  if (apiKey === null) {
    await fs.rm(path, { force: true });
    return;
  }
  const body = JSON.stringify({ version: 1, apiKey, updatedAt: new Date().toISOString() }, null, 2);
  await writeFileAtomic(path, `${body}\n`, { createMode: 0o600 });
}

/** What a route may send: the preference plus whether a key exists. */
export interface RedactedDictationSettings extends DictationConfig {
  hasApiKey: boolean;
}

export async function redactedDictationSettings(): Promise<RedactedDictationSettings> {
  const [config, apiKey] = await Promise.all([readDictationConfig(), readDictationApiKey()]);
  return { ...config, hasApiKey: apiKey !== null };
}
