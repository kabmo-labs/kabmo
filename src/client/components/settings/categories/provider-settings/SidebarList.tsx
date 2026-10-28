import { useRef, useState } from 'preact/hooks';
import { Plus, Search, Trash2, X } from 'lucide-preact';
import type { ProviderItem } from '@/shared/types';
import { ProviderIconPlate } from '@/client/components/settings/categories/provider-settings/IconPlate';
import {
  groupProviders,
  providerDeletable,
  providerStatusLabel,
  providerStatusTone,
  type ProviderStatusTone,
} from '@/client/components/settings/categories/provider-settings/groups';

interface ProviderSidebarListProps {
  providers: ProviderItem[];
  selectedProviderId: string;
  onSelectProvider: (id: string) => void;
  onOpenAddModal: () => void;
  /** Removes one provider — its models.yml entry and/or its Kabmo overlay row. */
  onDeleteProvider: (provider: ProviderItem) => void;
  /** Why the list could not be read in full, when it could not. */
  catalogError?: string;
}

const DOT_CLASS: Record<ProviderStatusTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  muted: 'bg-ink/25',
};

/**
 * The provider list: a search field, then omp's own three sections.
 *
 * Every provider omp knows is listed, including one with no credential —
 * that row is the way IN to signing it in. The status dot and the row's title
 * say which state it is in, because a list where "signed in" and "omp merely
 * knows this" look identical is a list where the user cannot tell what a click
 * will do.
 *
 * Delete lives on the row, not only in the detail pane: removing a provider is
 * a decision about the LIST, and requiring a select-first detour meant the
 * action was invisible until you had already committed to looking at it.
 */
export function ProviderSidebarList({
  providers,
  selectedProviderId,
  onSelectProvider,
  onOpenAddModal,
  onDeleteProvider,
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
                  <div
                    key={item.id}
                    className={`group/row flex items-center rounded-md transition-colors ${
                      isSelected ? 'bg-ink/10 shadow-2xs' : 'hover:bg-ink/5'
                    }`}
                  >
                    {/* The trailing columns are FIXED WIDTHS and the name takes
                        the slack (`flex-1`), so the status dot and the model
                        count line up down the list instead of following
                        whatever width each name happens to be. */}
                    <button
                      type="button"
                      onClick={() => onSelectProvider(item.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      title={providerStatusLabel(item)}
                      className={`flex-1 min-w-0 flex items-center gap-2 pl-1.5 pr-1 py-1 rounded-md text-left cursor-pointer ${
                        isSelected ? 'text-ink font-medium' : 'text-ink/80 hover:text-ink'
                      }`}
                    >
                      <ProviderIconPlate provider={item} size={22} />
                      <span className="flex-1 min-w-0 text-[12px] truncate">{item.name}</span>
                      <span aria-hidden className="w-2 shrink-0 flex items-center justify-center">
                        <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[providerStatusTone(item)]}`} />
                      </span>
                      <span className="w-8 shrink-0 text-right text-[10px] font-mono tabular-nums text-ink/45">
                        {item.models.length}
                      </span>
                    </button>
                    {/* One click: the confirmation DIALOG is the confirmation,
                        and it is the only place that says what disappears (a
                        models.yml entry, or just Kabmo's own row). A second
                        inline "click again" step made deleting three clicks for
                        a decision the dialog already asks for.

                        Only where something can go: a provider omp discovered
                        from an endpoint has no models.yml entry and no overlay
                        row, so a delete button there is a control whose only
                        outcome is a refusal. */}
                    {/* The slot is reserved on EVERY row: a button that exists
                        only on some rows shifted those rows' count column by
                        its own width. */}
                    <span className="w-6 shrink-0 flex items-center justify-center">
                      {providerDeletable(item) && (
                        <button
                          type="button"
                          onClick={() => onDeleteProvider(item)}
                          title={`Delete ${item.name}`}
                          aria-label={`Delete ${item.name}`}
                          className="p-1 rounded transition-colors cursor-pointer text-ink/35 hover:text-error hover:bg-error/10 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
