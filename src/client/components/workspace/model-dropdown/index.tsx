import type { TargetedMouseEvent } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, Sparkles } from 'lucide-preact';
import type { AIModelOption, ModelPreferences } from '@/shared/types';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { ModelDropdownPanel } from '@/client/components/workspace/model-dropdown/Panel';
import { ProviderIcon } from '@/client/components/common/provider-icon';
import { useModelCatalog } from '@/client/components/workspace/model-dropdown/use-catalog';
import { buildPickerGroups } from '@/client/components/workspace/model-dropdown/groups';
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
  const [hoveredModel, setHoveredModel] = useState<AIModelOption | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const {
    models,
    isLoading,
    setModels,
    selectedModel,
    setSelectedModel,
    preferences,
    applyPreferences,
  } = useModelCatalog(externalSelectedModel);

  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => {
    setIsOpen(false);
    setHoveredModel(null);
    setFocusedIndex(-1);
  });

  const {
    filtered: filteredModels,
    favorites: favoriteModels,
    recent: recentModels,
    byProvider: providerGroups,
    visibleFlatList,
    index: modelIndex,
  } = useMemo(
    () => buildPickerGroups(models, search, collapsedSections, preferences.favorites, preferences.recentKeys),
    [models, search, collapsedSections, preferences],
  );

  const selectedModelKey = modelKey(selectedModel);

  const handleAddProviderClick = () => {
    setIsOpen(false);
    setHoveredModel(null);
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

  const toggleSection = (section: string) => {
    setCollapsedSections(prev => ({ ...prev, [section]: !prev[section] }));
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
    setHoveredModel(null);
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

  const handleKeyDown = (e: globalThis.KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setFocusedIndex(prev => {
        const next = (prev + 1) % Math.max(1, visibleFlatList.length);
        setHoveredModel(visibleFlatList[next] || null);
        return next;
      });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusedIndex(prev => {
        const prevIdx = (prev - 1 + visibleFlatList.length) % Math.max(1, visibleFlatList.length);
        setHoveredModel(visibleFlatList[prevIdx] || null);
        return prevIdx;
      });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = (focusedIndex >= 0 ? visibleFlatList[focusedIndex] : null) || hoveredModel;
      if (target) handleSelect(target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
      setHoveredModel(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = (focusedIndex >= 0 ? visibleFlatList[focusedIndex] : null) || hoveredModel;
      if (target) toggleAgentCmd(target);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const target = (focusedIndex >= 0 ? visibleFlatList[focusedIndex] : null) || hoveredModel;
      if (target) cycleThinkingLevel(target);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef} onKeyDown={handleKeyDown}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          setHoveredModel(null);
          setFocusedIndex(-1);
        }}
        className="flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-ink/80 font-medium cursor-pointer min-w-0 max-w-full"
        title={selectedModel ? `${selectedModel.provider} • ${selectedModel.name}` : 'Select a model'}
      >
        {selectedModel ? (
          <>
            <span className="text-ink/60 flex-shrink-0">
              {selectedModel.isCmdAgent ? (
                <span className="font-mono text-[10px] font-bold text-ink/70">⌘</span>
              ) : (
                <ProviderIcon
                  icon={selectedModel.providerIcon}
                  slug={selectedModel.provider}
                  name={selectedModel.provider}
                  size={12}
                />
              )}
            </span>
            <span className="flex items-center space-x-1 min-w-0">
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
          collapsedSections={collapsedSections}
          onToggleCollapse={toggleSection}
          selectedModelKey={selectedModelKey}
          modelIndex={modelIndex}
          focusedIndex={focusedIndex}
          hoveredModel={hoveredModel}
          onSelect={handleSelect}
          onToggleFavorite={handleToggleFavorite}
          onCycleThinking={cycleThinkingLevel}
          onHoverItem={(idx, m) => {
            setFocusedIndex(idx);
            setHoveredModel(m);
          }}
          onMouseLeave={() => setHoveredModel(null)}
        />
      )}
    </div>
  );
}
