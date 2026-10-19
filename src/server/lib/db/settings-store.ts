import type { DbClient } from '@/server/lib/db/client';
import { isMockMode } from '@/server/mock.server';

/**
 * Shared persistence helpers for the `app_settings` key/value table. Every
 * settings route used to hand-roll the same SELECT → JSON.parse → Array.isArray
 * → INSERT OR REPLACE state machine; this module owns it once.
 *
 * SQL is intentionally identical to the call sites it replaces: same table,
 * same columns, same `INSERT OR REPLACE` (no schema change, no migration).
 */

const SELECT_VALUE_SQL = 'SELECT value FROM app_settings WHERE key = ?';
const SELECT_ALL_SQL = 'SELECT * FROM app_settings';
const UPSERT_VALUE_SQL = 'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)';

/** Read + parse one settings key, falling back on an absent or malformed row. */
export async function readSettingsJson<T>(db: DbClient, key: string, fallback: T): Promise<T> {
  const row = await db.get<{ value?: string }>(SELECT_VALUE_SQL, [key]);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

/** Persist one settings key as JSON (matches the historical `JSON.stringify`). */
export async function writeSettingsJson(db: DbClient, key: string, value: unknown): Promise<void> {
  await db.run(UPSERT_VALUE_SQL, [key, JSON.stringify(value)]);
}

/** Persist one settings key as a raw string (settings/root.ts scalar branch). */
export async function writeSettingsRaw(db: DbClient, key: string, value: string): Promise<void> {
  await db.run(UPSERT_VALUE_SQL, [key, value]);
}

/** A JSON object that is not an array — the only shape a key-wise merge applies to. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Shallow-merge a plain-object patch into the object already stored for `key`.
 *
 * A patch is the only thing the settings client can send without republishing
 * values it merely read: the settings blob is written by two
 * writers (the settings modal, the theme picker) and read by many, so a writer
 * that echoed its whole copy would discard whatever another writer stored in
 * between. Merging is what makes a partial write safe; a stored value that is
 * absent or not an object is replaced outright, and arrays still replace
 * because a list has no per-key identity to merge on.
 */
export async function mergeSettingsJson(
  db: DbClient,
  key: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const stored = await readSettingsJson<unknown>(db, key, null);
  await writeSettingsJson(db, key, { ...(isPlainObject(stored) ? stored : {}), ...patch });
}

/** Read every settings row, parsing JSON where possible and keeping raw text otherwise. */
export async function readAllSettingsJson(db: DbClient): Promise<Record<string, unknown>> {
  const rows = await db.all<{ key: string; value: string }>(SELECT_ALL_SQL);
  const settings: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      settings[row.key] = JSON.parse(row.value);
    } catch {
      settings[row.key] = row.value;
    }
  }
  return settings;
}

interface StoredListOptions<T> {
  /** Used when the row is absent or malformed. */
  absent?: T[];
  /** Used when the stored value parses to an empty array. */
  empty?: T[];
}

export interface SettingsListStore<T> {
  key: string;
  /** Loader semantics: mock default, first-read seeding in mock mode, array-guarded parse. */
  read(db: DbClient): Promise<T[]>;
  /** Action semantics: no seeding; `absent`/`empty` control the fallbacks. */
  readStored(db: DbClient, options?: StoredListOptions<T>): Promise<T[]>;
  write(db: DbClient, items: T[]): Promise<void>;
  /** Array | { <plural>: [...] } | { <singular>: item } → resulting list (not persisted). */
  upsert(db: DbClient, body: unknown, options?: StoredListOptions<T>): Promise<T[]>;
  /** Merge one item by identity into the stored list (not persisted). */
  upsertItem(db: DbClient, item: T, options?: StoredListOptions<T>): Promise<T[]>;
  /** Filter one item out by identity and persist the result. */
  remove(db: DbClient, id: string, options?: StoredListOptions<T>): Promise<T[]>;
}

/**
 * Build a JSON-list store for one `app_settings` key. `mockDefaults` is seeded
 * on first read in mock mode and returned whenever the row is absent or
 * unparseable; `idOf`/`singular`/`plural` drive the upsert + remove shapes.
 */
export function createSettingsListStore<T>(options: {
  key: string;
  mockDefaults: T[];
  idOf: (item: T) => string;
  singular: string;
  plural: string;
}): SettingsListStore<T> {
  const { key, mockDefaults, idOf, singular, plural } = options;

  async function read(db: DbClient): Promise<T[]> {
    const mock = isMockMode();
    const row = await db.get<{ value?: string }>(SELECT_VALUE_SQL, [key]);
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
      return mock ? mockDefaults : [];
    }
    if (mock) {
      await db.run(UPSERT_VALUE_SQL, [key, JSON.stringify(mockDefaults)]);
      return mockDefaults;
    }
    return [];
  }

  async function readStored(db: DbClient, options: StoredListOptions<T> = {}): Promise<T[]> {
    const row = await db.get<{ value?: string }>(SELECT_VALUE_SQL, [key]);
    let list: T[] | null = null;
    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (Array.isArray(parsed)) list = parsed;
      } catch {}
    }
    if (list === null) return options.absent ?? (isMockMode() ? mockDefaults : []);
    if (list.length === 0 && options.empty) return options.empty;
    return list;
  }

  async function write(db: DbClient, items: T[]): Promise<void> {
    await db.run(UPSERT_VALUE_SQL, [key, JSON.stringify(items)]);
  }

  async function upsertItem(db: DbClient, item: T, options: StoredListOptions<T> = {}): Promise<T[]> {
    const list = await readStored(db, options);
    const index = list.findIndex((entry) => idOf(entry) === idOf(item));
    if (index >= 0) list[index] = item;
    else list.push(item);
    return list;
  }

  async function upsert(db: DbClient, body: unknown, options: StoredListOptions<T> = {}): Promise<T[]> {
    if (Array.isArray(body)) return body;
    if (typeof body === 'object' && body !== null) {
      const record = body as Record<string, unknown>;
      if (Array.isArray(record[plural])) return record[plural];
      if (record[singular]) return upsertItem(db, record[singular] as T, options);
    }
    return [];
  }

  async function remove(db: DbClient, id: string, options: StoredListOptions<T> = {}): Promise<T[]> {
    const list = (await readStored(db, options)).filter((item) => idOf(item) !== id);
    await write(db, list);
    return list;
  }

  return { key, read, readStored, write, upsert, upsertItem, remove };
}
