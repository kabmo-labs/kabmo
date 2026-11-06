import { useMemo, useRef, useState } from 'preact/hooks';
import { ChevronDown, Sparkles } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import { invalidateModelsCache } from '@/shared/lib/models/client';
import { ModelDropdownPanel } from '@/client/components/workspace/model-dropdown/Panel';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';
import { useModelCatalog } from '@/client/components/workspace/model-dropdown/use-catalog';
import { useCollapsedSections } from '@/client/components/workspace/model-dropdown/collapsed';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { useFullscreenPicker } from '@/client/components/workspace/model-dropdown/fullscreen-picker';
import { harnessModels } from '@/client/components/workspace/model-dropdown/harness-models';
import { useRowMutations } from '@/client/components/workspace/model-dropdown/row-mutations';
import { HarnessGlyph, HARNESS_GLYPH_SIZE } from '@/client/components/common/harness-glyph';
import { buildPickerGroups, type PickerRow } from '@/client/components/workspace/model-dropdown/groups';
import { modelKey } from '@/shared/lib/models/identity';
import { RECENT_MODELS_LIMIT, filterKnownKeys, recordRecentKey } from '@/shared/lib/models/preferences';

interface ModelDropdownProps {
  selectedModel?: AIModelOption;
  onSelectModel?: (model: AIModelOption) => void;
  onOpenAddProvider?: () => void;
  onThinkingLevelChange?: (level: string) => void;
  className?: string;
  /** The session's harness (`omp-rpc`, `claude`, …). Undefined for a chat that
   *  has not spawned: the picker then shows the user's last choice. */
  harness?: string;
  /** Picked a tab for a chat that has no transcript yet. */
  onSelectHarness?: (harness: string) => void;
  /** False while the open chat has messages; the tabs explain instead of
   *  switching. */
  harnessEditable?: boolean;
  /** The SHELL's layout verdict. When omitted the picker answers for itself from
   *  the pointer — which is what the New Chat modal's preview does. */
  isMobile?: boolean;
}

export function ModelDropdown({
  selectedModel: externalSelectedModel,
  onSelectModel,
  onOpenAddProvider,
  onThinkingLevelChange,
  className = '',
  harness,
  onSelectHarness,
  harnessEditable = true,
  isMobile,
}: ModelDropdownProps) {
  const { harnesses, probe } = useHarnesses();
  /**
   * The harness whose list is on screen.
   *
   * Seeded from the SESSION's harness; before a chat exists the user moves it
   * with the tab strip and the pick rides the spawn. It lives here rather than
   * in the parent because the list it selects is this component's whole
   * content.
   */
  const [viewHarness, setViewHarness] = useState<string>(harness ?? 'omp-rpc');
  const activeHarness = harness ?? viewHarness;
  const [isOpen, setIsOpen] = useState(false);
  // One answer to "which placement", used by BOTH the frame and the click-outside
  // guard: a portalled full-screen picker is outside `containerRef` by
  // construction, so an armed outside-press listener would close it on the very
  // press that was meant to choose a row.
  const fullscreen = useFullscreenPicker(isMobile);
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
   * The rows this tab renders. `harnessModels` returns omp's registry untouched
   * for omp's tab and the agent's OWN `configOptions[model]` list for every
   * other — never a merge, because a row the active agent cannot run would fail
   * at the first prompt.
   */
  const harnessList = useMemo(
    () => harnessModels(harnesses, activeHarness, models),
    [harnesses, activeHarness, models],
  );
  const visibleModels = harnessList.models;

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
    const fromCatalog = visibleModels.find(
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
  }, [selectedModel, visibleModels]);

  const containerRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(containerRef, () => {
    setIsOpen(false);
    setHoveredRow(null);
    setFocusedIndex(-1);
  }, !fullscreen);

  const {
    filtered: filteredModels,
    favorites: favoriteModels,
    recent: recentModels,
    byProvider: providerGroups,
    ambiguousNames,
    visibleFlatList,
    index: modelIndex,
  } = useMemo(
    () => buildPickerGroups(visibleModels, search, collapsedSections, preferences.favorites, preferences.recentKeys),
    [visibleModels, search, collapsedSections, preferences],
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

  const { toggleFavorite, cycleThinking, toggleAgentCmd } = useRowMutations({
    preferences, applyPreferences, setModels, selectedModel, setSelectedModel,
    selectedModelKey, onSelectModel, onThinkingLevelChange,
  });

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
      if (activeRow) cycleThinking(activeRow.model);
    }
  };

  return (
    // `data-model-dropdown-root` is the popover's measuring anchor: the panel
    // sizes itself to the space above THIS element, and picking the element by
    // attribute is exact where `parentElement.parentElement` would be a guess
    // that breaks the first time the markup gains a wrapper.
    <div
      className={`relative ${className}`}
      ref={containerRef}
      data-model-dropdown-root=""
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(prev => !prev);
          setHoveredRow(null);
          setFocusedIndex(-1);
        }}
        className="tap-chip flex items-center space-x-1.5 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-muted font-medium cursor-pointer min-w-0 max-w-full"
        title={selectedModel ? `${selectedModel.provider} • ${selectedModel.name}` : 'Select a model'}
      >
        {selectedModel ? (
          <>
            {/* Harness MARK, then the provider plate: the same two-mark order
                the rows use, so the trigger and the list cannot describe two
                different things. */}
            <HarnessGlyph harness={activeHarness} size={HARNESS_GLYPH_SIZE.compact} />
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
              <span className="shrink-0 text-muted font-normal">{selectedModel.provider}</span>
              <span className="text-ink/50 flex-shrink-0">•</span>
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
          isLoading={isLoading && visibleModels.length === 0}
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
          onToggleFavorite={toggleFavorite}
          onCycleThinking={cycleThinking}
          onHoverItem={(idx) => {
            setFocusedIndex(idx);
            // The flat list is the one order the panel renders, so an index is
            // enough to name the exact row — including which of a model's two
            // rows the pointer is on.
            setHoveredRow(visibleFlatList[idx] ?? null);
          }}
          onMouseLeave={() => setHoveredRow(null)}
          harnesses={harnesses}
          activeHarness={activeHarness}
          harnessEditable={harnessEditable}
          unprobedHarness={harnessList.unprobed}
          harnessBlocked={harnessList.blocked}
          onSelectHarness={(id) => {
            // The tab changes WHICH LIST this picker shows, in place. The pick
            // reaches the spawn through `onSelectHarness`; the picker stays open
            // so the user can then choose one of that harness's models.
            setViewHarness(id);
            setHoveredRow(null);
            setFocusedIndex(-1);
            setSearch('');
            onSelectHarness?.(id);
          }}
          // A blocked tab probes once: the answer is the agent's own words
          // (an auth command, a missing binary), and reporting it beats a
          // silently unclickable tab.
          onClose={() => {
            setIsOpen(false);
            setHoveredRow(null);
          }}
          fullscreen={fullscreen}
          onFixHarness={(id) => {
            void probe(id).then((reason) => {
              if (reason) console.warn(`[harness] ${id}: ${reason}`);
            });
          }}
        />
      )}
    </div>
  );
}
