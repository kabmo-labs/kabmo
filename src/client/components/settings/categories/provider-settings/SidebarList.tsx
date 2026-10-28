import { useRef, useState } from 'preact/hooks';
import { Plus, Search, X } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';
import {
  groupProviders,
  providerStatusLabel,
} from '@/client/components/settings/categories/provider-settings/groups';

interface ProviderSidebarListProps {
  providers: ProviderItem[];
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  onOpenAddModal: () => void;
  /** Why the list could not be read in full, when it could not. */
  catalogError?: string;
}

/**
 * The provider list: a search field, then omp's own three sections.
 *
 * Every provider omp knows is listed, including one with no credential — that
 * row is the way IN to signing it in. A row is a PLATE, a NAME and a COUNT, and
 * nothing else:
 *
 * - no status dot. The state is already the section the row sits in (Signed in
 *   / Not signed in / Disabled), so a coloured circle beside the name repeated
 *   it three times per screen — and a colour with no label is the one thing a
 *   reader cannot look up. The row's `title` still spells the state out.
 * - no delete button. Deleting is a decision about ONE provider, taken after
 *   reading what disappears (a models.yml entry, or just Kabmo's own row), and
 *   the confirmation dialog is where that belongs. A trash icon on every row
 *   turned a dense list into a field of icons that were mostly invisible until
 *   hovered, and it cost the count column its alignment on the rows where it
 *   did not apply.
 *
 * The count is the one thing that stays right-aligned and monospaced, because it
 * is a number: `109` and `0` have to line up down the column to be comparable.
 */
export function ProviderSidebarList({
  providers,
  selectedProviderId,
  onSelectProvider,
  onOpenAddModal,
  catalogError,
}: ProviderSidebarListProps) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const groups = groupProviders(providers, query);

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      <div className="px-3 pt-3 pb-2 flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-ink/50 uppercase">
          {providers.length} provider{providers.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onOpenAddModal}
          title="Add provider"
          aria-label="Add provider"
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative flex items-center">
          <Search size={12} className="absolute left-2.5 text-ink/40 pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            placeholder="Filter providers or models…"
            aria-label="Filter providers"
            className="w-full bg-paper border border-ink/15 rounded-md pl-7 pr-7 py-1.5 text-[11px] text-ink placeholder-ink/40 focus:outline-none focus:border-ink/40 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); searchRef.current?.focus(); }}
              title="Clear the filter"
              aria-label="Clear the filter"
              className="absolute right-1.5 p-0.5 rounded text-ink/40 hover:text-ink hover:bg-ink/10 transition-colors cursor-pointer"
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {catalogError && (
        <p className="mx-3 mb-2 px-2 py-1.5 rounded border border-amber-500/30 bg-amber-500/10 text-[10px] leading-relaxed text-ink/70">
          Model catalog unavailable: {catalogError}
        </p>
      )}

      <div className="flex-1 scrollbar-overlay-container px-1.5 pb-3">
        {groups.length === 0 ? (
          <div className="px-2.5 py-4 text-[11px] leading-relaxed text-ink/50">
            {query
              ? `No provider or model matches “${query}”.`
              : 'No providers detected yet. Use the plus button above to register one.'}
          </div>
        ) : groups.map((group) => (
          <div key={group.id} className="pt-1.5 first:pt-0">
            <div className="px-2 pb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold tracking-wider text-ink/45 uppercase">
                  {group.label}
                </span>
                <span className="text-[10px] font-mono text-ink/35">{group.providers.length}</span>
              </div>
              {group.hint && (
                <p className="text-[10px] leading-snug text-ink/40 mt-0.5">{group.hint}</p>
              )}
            </div>
            <div className="space-y-0.5">
              {group.providers.map((item) => {
                const isSelected = item.id === selectedProviderId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectProvider(item.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    title={providerStatusLabel(item)}
                    className={`w-full flex items-center gap-2 pl-1.5 pr-2 py-1 rounded-md text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                        : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
                    }`}
                  >
                    <ProviderIconPlate provider={item} size={22} />
                    {/* The name takes the slack, so the count column is the same
                        width on every row whatever the name's length is. */}
                    <span className="flex-1 min-w-0 text-[12px] truncate">{item.name}</span>
                    <span className="w-8 shrink-0 text-right text-[10px] font-mono tabular-nums text-ink/45">
                      {item.models.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
