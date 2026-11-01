/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The stored catalog sources — the git repositories the Skills Catalog offers.
 *
 * Its own module because two surfaces read it (the loader's payload and every
 * source mutation) and a second reader is how the two shapes would drift. The
 * normalisation is the whole job: a source written by the previous UI carried
 * `stars` and `updatedAt` literals that no request had produced, and a count
 * that was never measured. Reading through `toCatalogSource` drops the first two
 * and turns a missing count into `null` — "not scanned" — which is what the card
 * prints. A guessed number is indistinguishable from a measured one once it is on
 * screen, so it is never stored.
 */

import type { SkillCatalogSource } from '@/shared/types';
import { DEFAULT_CATALOG_SOURCES } from '@/client/data/settings/skill';
import { readSettingsJson, writeSettingsJson } from '@/server/lib/db/settings-store';
import type { DbClient } from '@/server/lib/db/client';

export const SOURCES_KEY = 'omp_catalog_sources';

/** One stored record, narrowed to the fields this build understands. */
export function toCatalogSource(source: Partial<SkillCatalogSource>): SkillCatalogSource {
  return {
    id: String(source.id ?? ''),
    name: String(source.name ?? source.repo ?? 'source'),
    repo: String(source.repo ?? ''),
    skillCount: typeof source.skillCount === 'number' ? source.skillCount : null,
    scannedAt: typeof source.scannedAt === 'number' ? source.scannedAt : null,
    isCustom: source.isCustom === true,
  };
}

/** Every source, with the shipped defaults standing in when none is stored. */
export async function readCatalogSources(db: DbClient): Promise<SkillCatalogSource[]> {
  const stored = await readSettingsJson<Partial<SkillCatalogSource>[]>(db, SOURCES_KEY, DEFAULT_CATALOG_SOURCES);
  const list = Array.isArray(stored) && stored.length > 0 ? stored : DEFAULT_CATALOG_SOURCES;
  // `toCatalogSource` with no id is a record this build cannot address; drop it
  // rather than render a card every action would 404 on.
  return list.map(toCatalogSource).filter((source) => source.id.length > 0 && source.repo.length > 0);
}

export async function writeCatalogSources(db: DbClient, sources: SkillCatalogSource[]): Promise<void> {
  await writeSettingsJson(db, SOURCES_KEY, sources);
}
