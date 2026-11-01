import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Dispatch, StateUpdater } from 'preact/hooks';
import type { CatalogSkillItem, GitSkillEntry, SkillCatalogSource, SkillItem } from '@/shared/types';

export interface SkillCatalogData {
  sources: SkillCatalogSource[];
  /** skills.sh results — the Browse tab's list. */
  catalogSkills: CatalogSkillItem[];
  userSkills: SkillItem[];
  setSources: Dispatch<StateUpdater<SkillCatalogSource[]>>;
  setUserSkills: Dispatch<StateUpdater<SkillItem[]>>;
  reload: () => Promise<void>;
  /** Search skills.sh for real; the answer replaces `catalogSkills`. */
  search: (query: string) => Promise<CatalogSkillItem[]>;
  addSource: (repo: string, name?: string) => Promise<SkillCatalogSource>;
  removeSource: (id: string) => Promise<void>;
  /**
   * Scan one source and store the real count. The answer also carries the
   * repository's skills so a caller can install straight from the card.
   */
  scanSource: (id: string) => Promise<{ skills: GitSkillEntry[]; notes: string[] }>;
}

interface CatalogPayload {
  catalogSources?: SkillCatalogSource[];
  catalogSkills?: CatalogSkillItem[];
  skills?: SkillItem[];
  error?: string;
}

interface ScanPayload extends CatalogPayload {
  repo?: string;
  notes?: string[];
}

/** One POST to the skills endpoint; a payload error becomes a thrown Error. */
async function post(body: unknown): Promise<CatalogPayload> {
  const response = await fetch('/api/settings/skills', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as CatalogPayload;
  if (!response.ok || data.error) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

/**
 * Catalog dataset behind the skill catalog screen.
 *
 * The initial load and the manual refresh hit the same endpoint and set the same
 * three slices, so both go through `reload`; each call site keeps its own
 * toast/error handling. The mutations answer the refreshed list, which is adopted
 * verbatim — the server is the one that re-reads the stored sources.
 */
export function useSkillCatalog(): SkillCatalogData {
  const [sources, setSources] = useState<SkillCatalogSource[]>([]);
  const [catalogSkills, setCatalogSkills] = useState<CatalogSkillItem[]>([]);
  const [userSkills, setUserSkills] = useState<SkillItem[]>([]);

  const adopt = useCallback((data: CatalogPayload) => {
    if (data.catalogSources) setSources(data.catalogSources);
    if (data.catalogSkills) setCatalogSkills(data.catalogSkills);
    if (data.skills) setUserSkills(data.skills);
  }, []);

  const reload = useCallback(async () => {
    const res = await fetch('/api/settings/skills');
    adopt((await res.json()) as CatalogPayload);
  }, [adopt]);

  const search = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) {
        // An empty query restores the loader's own popular list rather than
        // leaving the last search's rows on screen as if they were the catalog.
        await reload();
        return [];
      }
      const data = await post({ type: 'search_catalog', q: trimmed });
      const results = data.catalogSkills ?? [];
      setCatalogSkills(results);
      return results;
    },
    [reload],
  );

  const addSource = useCallback(
    async (repo: string, name?: string) => {
      const data = await post({ type: 'add_source', repo, ...(name ? { name } : {}) });
      adopt(data);
      const added = data.catalogSources?.at(-1);
      if (!added) throw new Error('The server stored the source but did not return it');
      return added;
    },
    [adopt],
  );

  const removeSource = useCallback(
    async (id: string) => {
      adopt(await post({ type: 'remove_source', id }));
    },
    [adopt],
  );

  const scanSource = useCallback(async (id: string) => {
    const data = (await post({ type: 'scan_source', id })) as ScanPayload & { skills?: GitSkillEntry[] };
    if (data.catalogSources) setSources(data.catalogSources);
    return { skills: data.skills ?? [], notes: data.notes ?? [] };
  }, []);

  useEffect(() => {
    reload().catch(console.error);
  }, [reload]);

  return {
    sources,
    catalogSkills,
    userSkills,
    setSources,
    setUserSkills,
    reload,
    search,
    addSource,
    removeSource,
    scanSource,
  };
}
