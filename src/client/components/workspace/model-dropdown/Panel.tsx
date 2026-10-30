import type { TargetedMouseEvent } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AIModelOption } from '@/shared/types';
import { ModelDropdownHeader } from '@/client/components/workspace/model-dropdown/Header';
import { ModelDropdownSection } from '@/client/components/workspace/model-dropdown/Section';
import { ModelDropdownFooter } from '@/client/components/workspace/model-dropdown/Footer';
import { ModelDropdownSkeleton } from '@/client/components/workspace/model-dropdown/Skeleton';
import { ModelSpecsTooltip } from '@/client/components/workspace/model-dropdown/SpecsTooltip';
import type { PickerRow } from '@/client/components/workspace/model-dropdown/groups';

interface ModelDropdownPanelProps {
  search: string;
  onSearchChange: (value: string) => void;
  onAddProvider: () => void;
  /** First `/api/models` fetch still in flight — render placeholder rows. */
  isLoading: boolean;
  filteredModels: AIModelOption[];
  favoriteModels: AIModelOption[];
  recentModels: AIModelOption[];
  providerGroups: Record<string, AIModelOption[]>;
  /** Lower-cased model names served by more than one provider. */
  ambiguousNames: ReadonlySet<string>;
  collapsedSections: Record<string, boolean>;
  onToggleCollapse: (section: string) => void;
  /** Composite (`provider:id`) key of the active selection. */
  selectedModelKey: string;
  /** Row id (`section::provider:id`) → index in the keyboard-navigation flat list. */
  modelIndex: Record<string, number>;
  focusedIndex: number;
  hoveredRow: PickerRow | null;
  onSelect: (model: AIModelOption) => void;
  onToggleFavorite: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onCycleThinking: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  /** Row index in the flat list; the panel resolves it to the row it renders. */
  onHoverItem: (index: number) => void;
  onMouseLeave: () => void;
}

export function ModelDropdownPanel({
  search,
  onSearchChange,
  onAddProvider,
  isLoading,
  filteredModels,
  favoriteModels,
  recentModels,
  providerGroups,
  ambiguousNames,
  collapsedSections,
  onToggleCollapse,
  selectedModelKey,
  modelIndex,
  focusedIndex,
  hoveredRow,
  onSelect,
  onToggleFavorite,
  onCycleThinking,
  onHoverItem,
  onMouseLeave,
}: ModelDropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** Distance from the panel's top to the card's, so the card tracks the row. */
  const [cardTop, setCardTop] = useState(0);

  // The card belongs to the ROW it describes, not to the panel: a card pinned
  // to the panel's middle described a model three rows away from it. The anchor
  // is the row's own `data-picker-row`, so the mouse and the keyboard resolve to
  // the same element — and so does each of the two rows one model can occupy
  // (its rail and its provider section). The offset is clamped to the panel
  // because a card hanging past the list reads as a second, unrelated panel.
  const alignCardToRow = useCallback(() => {
    const panel = panelRef.current;
    const card = cardRef.current;
    if (!panel || !card || !hoveredRow) return;
    const row = panel.querySelector(`[data-picker-row="${CSS.escape(hoveredRow.rowId)}"]`);
    if (!row) return;
    const panelBox = panel.getBoundingClientRect();
    const maxTop = Math.max(0, panelBox.height - card.offsetHeight);
    const next = Math.min(maxTop, Math.max(0, row.getBoundingClientRect().top - panelBox.top));
    // Same offset ⇒ no state write, so scrolling does not re-render the panel.
    setCardTop((prev) => (prev === next ? prev : next));
  }, [hoveredRow]);

  useLayoutEffect(alignCardToRow, [alignCardToRow, collapsedSections]);

  return (
    <div className="absolute bottom-full left-0 mb-2.5 z-50 flex items-start">
      <div ref={panelRef} className="w-84 sm:w-96 bg-paper border border-ink/20 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs max-h-[460px] animate-in fade-in zoom-in-95 duration-100">
        <ModelDropdownHeader
          search={search}
          onSearchChange={onSearchChange}
          onAddProvider={onAddProvider}
        />

        {/* Scrollable Model Lists */}
        <div
          className="flex-1 scrollbar-overlay-container p-1.5 space-y-2 max-h-80"
          onMouseLeave={onMouseLeave}
          // The row under a resting pointer moves when the list scrolls; the
          // card follows it instead of staying where the hover started.
          onScroll={alignCardToRow}
        >
          {isLoading ? (
            <ModelDropdownSkeleton />
          ) : filteredModels.length === 0 ? (
            <div className="px-3 py-6 text-center text-ink/40 italic">
              {search ? (
                <>No models found matching &quot;{search}&quot;</>
              ) : (
                <>No models available. Enable a provider in Settings → Providers.</>
              )}
            </div>
          ) : (
            <>
              <ModelDropdownSection
                id="favorites"
                title="FAVORITES"
                iconType="star"
                models={favoriteModels}
                isCollapsed={!!collapsedSections['favorites']}
                onToggleCollapse={onToggleCollapse}
                selectedModelKey={selectedModelKey}
                modelIndex={modelIndex}
                ambiguousNames={ambiguousNames}
                focusedIndex={focusedIndex}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
                onCycleThinking={onCycleThinking}
                onHoverItem={onHoverItem}
              />

              <ModelDropdownSection
                id="recent"
                title="RECENT"
                iconType="recent"
                models={recentModels}
                isCollapsed={!!collapsedSections['recent']}
                onToggleCollapse={onToggleCollapse}
                selectedModelKey={selectedModelKey}
                modelIndex={modelIndex}
                ambiguousNames={ambiguousNames}
                focusedIndex={focusedIndex}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
                onCycleThinking={onCycleThinking}
                onHoverItem={onHoverItem}
              />

              {Object.entries(providerGroups).map(([provider, pModels]) => (
                <ModelDropdownSection
                  key={provider}
                  id={provider}
                  title={provider}
                  iconType="provider"
                  models={pModels}
                  isCollapsed={!!collapsedSections[provider]}
                  onToggleCollapse={onToggleCollapse}
                  selectedModelKey={selectedModelKey}
                  modelIndex={modelIndex}
                  ambiguousNames={ambiguousNames}
                  focusedIndex={focusedIndex}
                  onSelect={onSelect}
                  onToggleFavorite={onToggleFavorite}
                  onCycleThinking={onCycleThinking}
                  onHoverItem={onHoverItem}
                />
              ))}
            </>
          )}
        </div>

        <ModelDropdownFooter />
      </div>

      {/* Floating Specs Card: only visible when hovering or keyboard navigating.
          `translateY` rather than a top offset keeps it out of the flex row's
          sizing, so the card can never stretch or shift the panel itself. */}
      {hoveredRow && (
        <div
          ref={cardRef}
          className="hidden lg:block ml-2"
          style={{ transform: `translateY(${cardTop}px)` }}
        >
          <ModelSpecsTooltip model={hoveredRow.model} />
        </div>
      )}
    </div>
  );
}
