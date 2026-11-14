import { useEffect, useRef, useState } from 'preact/hooks';
import { Loader2, RefreshCw, Search, X } from 'lucide-preact';
import type { CatalogSkillItem } from '@/shared/types';
import { invalidateComposerCache } from '@/shared/lib/chat/composer/client';
import { skillsharePackage } from '@/shared/lib/omp/skill-source';
import { useToasts } from '@/client/hooks/ui/toasts';
import { useSkillCatalog } from '@/client/hooks/settings/skill-catalog';
import { useSkillGitImport } from '@/client/hooks/settings/skill-git-import';
import { SkillCard } from '@/client/components/settings/categories/skill-catalog/SkillCard';
import { SourceRail } from '@/client/components/settings/categories/skill-catalog/SourceRail';
import { GitImportPanel } from '@/client/components/settings/categories/skill-catalog/GitImportPanel';

export type CatalogTab = 'browse' | 'git' | 'sources';

const TABS: Array<{ id: CatalogTab; label: string }> = [
  { id: 'browse', label: 'Browse' },
  { id: 'git', label: 'From Git' },
  { id: 'sources', label: 'Sources' },
];

const SEARCH_DEBOUNCE_MS = 300;

/**
 * The Skills Catalog screen: three surfaces over the same two sources of truth.
 *
 * Browse is the Skillshare registry omp installs from, From Git is an arbitrary
 * repository, Sources is the list of repositories either one can offer. They
 * share `useSkillCatalog` so an install in one tab is visible in the others
 * without a second fetch, and the tab strip is the only place the three are
 * named.
 *
 * Search is SERVER-side and goes through `omp skill search`, so the registry
 * URL is omp's own `skills.registryUrl` and the results are the packages
 * `omp skill install` can actually resolve. The box used to filter the ~26 rows
 * the loader had pre-fetched, so a query the catalog really held answered "no
 * skills found" — a false negative the user could not distinguish from an empty
 * registry.
 */
export function SkillCatalogSettings({ initialTab = 'browse' }: { initialTab?: CatalogTab } = {}) {
  const catalog = useSkillCatalog();
  const git = useSkillGitImport();
  const [tab, setTab] = useState<CatalogTab>(initialTab);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busySkill, setBusySkill] = useState<string | null>(null);
  const [scanningSource, setScanningSource] = useState<string | null>(null);
  const [sourceBusy, setSourceBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const installedPackages = new Set(
    catalog.userSkills
      .map((skill) => skillsharePackage(skill.source))
      .filter((pkg): pkg is string => pkg !== null),
  );

  const { pushToast } = useToasts();

  useEffect(() => () => clearTimeout(debounce.current), []);

  const runSearch = (value: string) => {
    setQuery(value);
    clearTimeout(debounce.current);
    if (!value.trim()) {
      void catalog.search('').catch(console.error);
      return;
    }
    debounce.current = setTimeout(() => {
      setSearching(true);
      catalog
        .search(value)
        .catch((error) => pushToast(error instanceof Error ? error.message : String(error), 'error'))
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
  };

  const handleInstallToggle = async (skill: CatalogSkillItem) => {
    const isInstalled = installedPackages.has(skill.repoTag);
    setBusySkill(skill.id);
    try {
      const response = await fetch('/api/settings/skills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'install_toggle', skill, install: !isInstalled }),
      });
      const data = await response.json();
      if (!response.ok || data?.error) throw new Error(data?.error || `Request failed (${response.status})`);
      if (Array.isArray(data?.skills)) catalog.setUserSkills(data.skills);
      invalidateComposerCache('command');
      pushToast(isInstalled ? `Uninstalled "${skill.name}"` : `Installed "${skill.name}"`, 'success');
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setBusySkill(null);
    }
  };

  const refresh = () => {
    setRefreshing(true);
    // Re-run the query on screen: the loader's own list is empty, so a plain
    // reload would clear the results the user is looking at.
    const action = query.trim() ? catalog.search(query) : catalog.reload();
    action
      .then(() => pushToast('Catalog refreshed', 'success'))
      .catch((error) => pushToast(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => setRefreshing(false));
  };

  const scanSource = (id: string) => {
    setScanningSource(id);
    catalog
      .scanSource(id)
      .then(({ skills }) => pushToast(`Found ${skills.filter((skill) => skill.loadable).length} loadable skill(s)`, 'success'))
      .catch((error) => pushToast(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => setScanningSource(null));
  };

  const addSource = () => {
    setTab('git');
    git.reset();
  };

  const removeSource = (id: string) => {
    setSourceBusy(true);
    catalog
      .removeSource(id)
      .then(() => pushToast('Source removed', 'success'))
      .catch((error) => pushToast(error instanceof Error ? error.message : String(error), 'error'))
      .finally(() => setSourceBusy(false));
  };

  const importFrom = (repo: string) => {
    setTab('git');
    void git.inspect(repo);
  };

  return (
    <div className="flex-1 flex flex-col h-full w-full overflow-hidden bg-paper text-ink">
      <div className="flex-shrink-0 px-6 md:px-8 pt-5">
        <div className="flex items-center gap-1 border-b border-ink/10">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              className={`px-3 py-2 -mb-px text-xs font-semibold border-b-2 transition-colors cursor-pointer ${
                tab === entry.id
                  ? 'border-ink text-ink'
                  : 'border-transparent text-ink/55 hover:text-ink hover:border-ink/25'
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto scrollbar-overlay-container px-6 md:px-8 py-5 space-y-5">
        {tab === 'browse' ? (
          <>
            <div className="relative">
              {searching ? (
                <Loader2 size={15} className="absolute left-3 top-2.5 text-ink/40 animate-spin" />
              ) : (
                <Search size={15} className="absolute left-3 top-2.5 text-ink/40 pointer-events-none" />
              )}
              <input
                type="text"
                value={query}
                onInput={(event) => runSearch(event.currentTarget.value)}
                placeholder="Search the Skillshare registry…"
                className="w-full pl-9 pr-9 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper focus:outline-none focus:border-ink text-xs text-ink transition-colors"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => runSearch('')}
                  aria-label="Clear the search"
                  className="absolute right-2 top-1.5 p-1 rounded-md text-ink/40 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink/55">
                {query.trim()
                  ? `${catalog.catalogSkills.length} skill(s) for “${query.trim()}”`
                  : 'Search the registry to list skills'}
              </span>
              <button
                type="button"
                onClick={refresh}
                disabled={refreshing}
                title="Re-read the catalog"
                className="flex items-center gap-1 p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
                <span className="text-[11px]">Refresh</span>
              </button>
            </div>

            <div className="space-y-3">
              {catalog.catalogSkills.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-ink/15 rounded-xl space-y-1">
                  <p className="text-xs text-ink/60">
                    {query.trim() ? 'No skills match that query.' : 'No skills listed yet.'}
                  </p>
                  <p className="text-[11px] text-ink/45">
                    {query.trim()
                      ? 'Try another query, or install straight from a repository in '
                      : 'Type a query to search the Skillshare registry, or install from a repository in '}
                    <span className="font-semibold">From Git</span>.
                  </p>
                </div>
              ) : (
                catalog.catalogSkills.map((skill) => (
                  <SkillCard
                    key={skill.id}
                    skill={skill}
                    installed={installedPackages.has(skill.repoTag)}
                    busy={busySkill === skill.id}
                    onInstallToggle={handleInstallToggle}
                  />
                ))
              )}
            </div>
          </>
        ) : null}

        {tab === 'git' ? (
          <GitImportPanel
            controller={git}
            onInstalled={() => {
              catalog.reload().catch(console.error);
              invalidateComposerCache('command');
              pushToast('Skills installed — omp sessions were reloaded', 'success');
            }}
          />
        ) : null}

        {tab === 'sources' ? (
          <SourceRail
            sources={catalog.sources}
            onScan={scanSource}
            onImportFrom={importFrom}
            onRemove={removeSource}
            onAdd={addSource}
            scanningId={scanningSource}
            busy={sourceBusy || scanningSource !== null}
          />
        ) : null}
      </div>
    </div>
  );
}
