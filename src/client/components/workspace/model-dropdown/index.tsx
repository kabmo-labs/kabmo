import type { TargetedMouseEvent } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, Sparkles } from 'lucide-preact';
import type { AIModelOption, ModelPreferences } from '@/shared/types';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { ModelDropdownPanel } from '@/client/components/workspace/model-dropdown/Panel';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';
import { useModelCatalog } from '@/client/components/workspace/model-dropdown/use-catalog';
import { useCollapsedSections } from '@/client/components/workspace/model-dropdown/collapsed';
import { buildPickerGroups, type PickerRow } from '@/client/components/workspace/model-dropdown/groups';
import { modelKey } from '@/shared/lib/models/identity';
import { RECENT_MODELS_LIMIT, filterKnownKeys, readModelPreferences, recordRecentKey, toggleFavoriteKey } from '@/shared/lib/models/preferences';

interface ModelDropdownProps {
  selectedModel?: AIModelOption;
  onSelectModel?: (model: AIModelOption) => void;
  onOpenAddProvider?: () => void;
  onThinkingLevelChange?: (level: string) => void;
  className?: string;
}

export function ModelDropdown({
  selectedModel: externalSelectedModel,
  onSelectModel,
  onOpenAddProvider,
  onThinkingLevelChange,
  className = '',
}: ModelDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  // Hover is a ROW, not a model: one model can be drawn twice (its rail and its
  // provider section), and both the specs card and the keyboard focus have to
  // address the row the pointer is actually on.
  const [hoveredRow, setHoveredRow] = useState<PickerRow | null>(null);
  const [collapsedSections, toggleSection] = useCollapsedSections();
  const {
    models,
    isLoading,
    setModels,
    selectedModel,
    setSelectedModel,
    preferences,
    applyPreferences,
  } = useModelCatalog(externalSelectedModel);

  /**
   * The selected model's mark, resolved against the CATALOG when the value the
   * composer handed us is a bare `{provider, id}` pair.
   *
   * The selection travels out of this component as `onSelectModel(model)` and
   * comes back as a prop built by the parent from `provider` + `id` — which
   * carries neither `providerIcon` nor `providerIconUrl`. Reading only the prop
   * made the trigger fall back to initials for a provider whose site logo the
   * picker itself was already showing one row below.
   */
  const selectedMark = useMemo(() => {
    if (!selectedModel) return null;
    const fromCatalog = models.find(
      (model) => model.provider === selectedModel.provider
        && (model.id === selectedModel.id || !selectedModel.id),
    );
    return {
      icon: selectedModel.providerIcon ?? fromCatalog?.providerIcon,
      slug: selectedModel.provider,
      name: selectedModel.provider,
      ...(selectedModel.providerIconUrl ?? fromCatalog?.providerIconUrl
        ? { iconUrl: selectedModel.providerIconUrl ?? fromCatalog?.providerIconUrl }
        : {}),
    };
  }, [selectedModel, models]);

  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => {
    setIsOpen(false);
    setHoveredRow(null);
    setFocusedIndex(-1);
  });

  const {
    filtered: filteredModels,
    favorites: favoriteModels,
    recent: recentModels,
    byProvider: providerGroups,
    ambiguousNames,
    visibleFlatList,
    index: modelIndex,
  } = useMemo(
    () => buildPickerGroups(models, search, collapsedSections, preferences.favorites, preferences.recentKeys),
    [models, search, collapsedSections, preferences],
  );

  const selectedModelKey = modelKey(selectedModel);

  const handleAddProviderClick = () => {
    setIsOpen(false);
    setHoveredRow(null);
    if (onOpenAddProvider) {
      onOpenAddProvider();
    } else {
      window.dispatchEvent(
        new CustomEvent('omp:open-settings', {
          detail: { category: 'providers', autoOpenAdd: true },
        })
      );
    }
  };

  /**
   * Flip one row's star. The optimistic stamp and the rollback both go through
   * the preference pair — the flag on a row is derived state, so patching the
   * row alone would be undone by the next `applyModelPreferences` (every reload
   * re-stamps rows from the store).
   */
  const handleToggleFavorite = async (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const key = modelKey(model);
    const previous = preferences;
    const optimistic: ModelPreferences = {
      ...previous,
      favorites: toggleFavoriteKey(previous.favorites, key),
    };
    applyPreferences(optimistic);
    try {
      const response = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'toggleFavorite', provider: model.provider, modelId: model.id }),
      });
      if (!response.ok) throw new Error(`toggleFavorite failed: ${response.status}`);
      const data = await response.json() as { modelPreferences?: unknown };
      // The server is the authority on the resulting list — it also drops keys
      // the registry no longer serves. An absent/malformed payload keeps the
      // optimistic list rather than blanking the rail.
      if (data.modelPreferences) {
        applyPreferences(readModelPreferences(data.modelPreferences));
      }
    } catch {
      // A failed write must not leave the star lit: the next reload would show
      // it unlit anyway, so the rollback keeps the panel honest immediately.
      applyPreferences(previous);
    }
  };

  const cycleThinkingLevel = (model: AIModelOption) => {
    const ladder = model.thinkingLevels ?? [];
    if (ladder.length === 0) return;
    const current = model.thinkingLevel ?? ladder[0];
    const idx = ladder.indexOf(current);
    const nextThinking = ladder[(idx + 1) % ladder.length];

    const key = modelKey(model);
    setModels(prev => prev.map(m => modelKey(m) === key ? { ...m, thinkingLevel: nextThinking } : m));
    // Only the active model's preset may reach the live session — cycling
    // another provider's row (or a non-selected model) must not push its
    // thinking level onto this session.
    if (selectedModelKey === key && selectedModel) {
      const nextSelected = { ...selectedModel, thinkingLevel: nextThinking };
      setSelectedModel(nextSelected);
      onSelectModel?.(nextSelected);
      onThinkingLevelChange?.(nextThinking);
    }
  };

  const toggleAgentCmd = async (model: AIModelOption) => {
    const nextCmd = !model.isCmdAgent;
    const key = modelKey(model);

    setModels(prev => prev.map(m => modelKey(m) === key ? { ...m, isCmdAgent: nextCmd } : m));
    if (selectedModelKey === key && selectedModel) {
      setSelectedModel({ ...selectedModel, isCmdAgent: nextCmd });
    }
    try {
      await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'toggleCmd', provider: model.provider, modelId: model.id }),
      });
    } catch {}
  };

  const handleSelect = async (model: AIModelOption) => {
    setSelectedModel(model);
    onSelectModel?.(model);
    setIsOpen(false);
    setHoveredRow(null);
    // Move the pick to the top of RECENT straight away — the server records it
    // alongside the selection, and waiting for the round trip would leave the
    // rail stale until the next full reload. Same rules as the server's write:
    // pruned to the models the registry serves, de-duplicated, capped.
    const known = new Set(models.map(modelKey));
    applyPreferences({
      favorites: filterKnownKeys(preferences.favorites, known),
      recentKeys: recordRecentKey(filterKnownKeys(preferences.recentKeys, known), modelKey(model), RECENT_MODELS_LIMIT),
    });
    try {
      await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionType: 'selectModel', model }),
      });
      invalidateModelsCache();
    } catch {}
  };

  /** The focused row, or the one under the pointer when no row is focused. */
  const activeRow = (focusedIndex >= 0 ? visibleFlatList[focusedIndex] : null) || hoveredRow;

  const handleKeyDown = (e: globalThis.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => {
        const next = (prev + 1) % Math.max(1, visibleFlatList.length);
        setHoveredRow(visibleFlatList[next] || null);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => {
        const prevIdx = (prev - 1 + visibleFlatList.length) % Math.max(1, visibleFlatList.length);
        setHoveredRow(visibleFlatList[prevIdx] || null);
        return prevIdx;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeRow) handleSelect(activeRow.model);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setHoveredRow(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (activeRow) toggleAgentCmd(activeRow.model);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      if (activeRow) cycleThinkingLevel(activeRow.model);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          setHoveredRow(null);
          setFocusedIndex(-1);
        }}
        className="flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-ink/80 font-medium cursor-pointer min-w-0 max-w-full"
        title={selectedModel ? `${selectedModel.provider} • ${selectedModel.name}` : 'Select a model'}
      >
        {selectedModel ? (
          <>
            {selectedModel.isCmdAgent ? (
              <span className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-[4px] border border-ink/20 bg-ink/5 text-ink/70 flex-shrink-0 font-mono text-[10px] font-bold">
                ⌘
              </span>
            ) : (
              <ProviderIconPlate provider={selectedMark ?? {}} size={16} />
            )}
            {/* Provider and model are two labels with a separator between them.
                The PROVIDER never truncates: `kenari` and `kenari-jatis` are two
                accounts, and an ellipsis made them render identically. The MODEL
                takes the slack, because it is the part the reader is choosing
                and the only part whose identity survives a cut. */}
            <span className="flex items-baseline gap-1 min-w-0">
              <span className="shrink-0 text-ink/50 font-normal">{selectedModel.provider}</span>
              <span className="text-ink/30 flex-shrink-0">•</span>
              <span className="min-w-0 flex-1 truncate">{selectedModel.name}</span>
            </span>
          </>
        ) : (
          /* No selection yet: the list is still loading or the registry came
             back empty. Show a pulse placeholder rather than a made-up model. */
          <>
            <span className="text-ink/60 flex-shrink-0">
              <Sparkles size={12} className="text-ink/60" />
            </span>
            <span className="h-3 w-28 rounded animate-pulse bg-ink/10" />
          </>
        )}
        <ChevronDown size={12} className="text-ink/40 flex-shrink-0" />
      </button>

      {/* Popover Dropdown */}
      {isOpen && (
        <ModelDropdownPanel
          search={search}
          onSearchChange={setSearch}
          onAddProvider={handleAddProviderClick}
          isLoading={isLoading}
          filteredModels={filteredModels}
          favoriteModels={favoriteModels}
          recentModels={recentModels}
          providerGroups={providerGroups}
          ambiguousNames={ambiguousNames}
          collapsedSections={collapsedSections}
          onToggleCollapse={toggleSection}
          selectedModelKey={selectedModelKey}
          modelIndex={modelIndex}
          focusedIndex={focusedIndex}
          hoveredRow={hoveredRow}
          onSelect={handleSelect}
          onToggleFavorite={handleToggleFavorite}
          onCycleThinking={cycleThinkingLevel}
          onHoverItem={(idx) => {
            setFocusedIndex(idx);
            // The flat list is the one order the panel renders, so an index is
            // enough to name the exact row — including which of a model's two
            // rows the pointer is on.
            setHoveredRow(visibleFlatList[idx] ?? null);
          }}
          onMouseLeave={() => setHoveredRow(null)}
        />
      )}
    </div>
  );
}
