import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { KeyboardEvent as ReactKeyboardEvent } from 'preact/compat';
import { Check, ChevronDown, Search } from 'lucide-preact';
import { statusLabel, type ProviderEntry, type UsageProviderId } from '@/client/components/settings/categories/usage-settings/providers';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface ProviderSelectProps {
  providers: ProviderEntry[];
  value: UsageProviderId;
  onChange: (id: UsageProviderId) => void;
}

const LISTBOX_ID = 'usage-provider-listbox';

/**
 * Custom provider picker for the right Usage panel. Mirrors the nested git
 * project dropdown (compact trigger, search row, check mark, outside-click
 * close) but is driven by the in-memory ProviderEntry[] and exposes listbox
 * keyboard semantics instead of touching any git API.
 */
export function ProviderSelect({ providers, value, onChange }: ProviderSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selected = providers.find((provider) => provider.id === value) ?? providers[0];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return providers;
    return providers.filter((provider) =>
      `${provider.name} ${statusLabel(provider)} ${provider.hint}`.toLowerCase().includes(needle),
    );
  }, [providers, query]);

  const openMenu = () => {
    const index = Math.max(0, providers.findIndex((provider) => provider.id === value));
    setQuery('');
    setActiveIndex(index);
    setOpen(true);
  };

  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    setQuery('');
    if (restoreFocus) triggerRef.current?.focus();
  };

  const commit = (id: UsageProviderId) => {
    onChange(id);
    closeMenu(true);
  };

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  useOnClickOutside(rootRef, () => setOpen(false));

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isSearchInput = event.target === inputRef.current;

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeMenu(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, Math.min(filtered.length - 1, index + 1)));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(0, filtered.length - 1));
        break;
      case 'Enter':
        event.preventDefault();
        if (filtered[activeIndex]) commit(filtered[activeIndex].id);
        break;
      case ' ':
        // Space types in the search field; only commits when focus is elsewhere.
        if (isSearchInput) return;
        event.preventDefault();
        if (filtered[activeIndex]) commit(filtered[activeIndex].id);
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative min-w-0" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={LISTBOX_ID}
        title="Select usage provider"
        className="flex w-full min-w-0 items-center justify-between gap-2 bg-paper border border-ink/15 rounded-lg px-3 py-1.5 text-xs text-ink hover:bg-ink/5 transition-colors"
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && <ProviderIcon slug={selected.id} name={selected.name} size={13} className="text-ink/60" />}
          <span className="truncate font-medium">{selected?.name ?? 'Select provider'}</span>
          {selected && (
            <span className="truncate text-[10px] text-ink/50">{statusLabel(selected)}</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`flex-shrink-0 text-ink/40 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-paper border border-ink/20 rounded-md shadow-lg z-50 flex flex-col overflow-hidden text-xs">
          <div className="px-2 py-1.5 border-b border-ink/10 flex items-center gap-1.5">
            <Search size={11} className="text-ink/40 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setActiveIndex(0);
              }}
              placeholder="Search providers..."
              title="Search providers"
              className="w-full min-w-0 bg-transparent outline-none text-xs text-ink placeholder-ink/40"
              autoFocus
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                title="Clear search"
                className="text-ink/40 hover:text-ink flex-shrink-0"
              >
                ×
              </button>
            )}
          </div>

          <div
            id={LISTBOX_ID}
            role="listbox"
            aria-label="Usage providers"
            className="max-h-48 scrollbar-overlay-container py-1"
          >
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-ink/40 italic">No providers found</div>
            ) : (
              filtered.map((provider, index) => (
                <button
                  key={provider.id}
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  type="button"
                  role="option"
                  aria-selected={provider.id === value}
                  onClick={() => commit(provider.id)}
                  onMouseEnter={() => setActiveIndex(index)}
                  title={provider.hint}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition-colors ${
                    index === activeIndex ? 'bg-ink/5' : 'hover:bg-ink/5'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <ProviderIcon slug={provider.id} name={provider.name} size={14} className="text-ink/60" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{provider.name}</span>
                      <span className="block truncate text-[10px] text-ink/50">
                        {statusLabel(provider)} · {provider.hint}
                      </span>
                    </span>
                  </span>
                  {provider.id === value && <Check size={12} className="flex-shrink-0 text-ink" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
