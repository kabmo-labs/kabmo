import type { TargetedMouseEvent } from 'preact';
import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { AIModelOption } from '@/shared/types';
import { ModelDropdownHeader } from '@/client/components/workspace/model-dropdown/Header';
import { ModelDropdownSection } from '@/client/components/workspace/model-dropdown/Section';
import { ModelDropdownFooter } from '@/client/components/workspace/model-dropdown/Footer';
import { ModelDropdownSkeleton } from '@/client/components/workspace/model-dropdown/Skeleton';
import { ModelSpecsTooltip } from '@/client/components/workspace/model-dropdown/SpecsTooltip';
import type { PickerRow } from '@/client/components/workspace/model-dropdown/groups';
import { HarnessTabs } from '@/client/components/workspace/model-dropdown/HarnessTabs';
import { usePopoverSize } from '@/client/components/workspace/model-dropdown/use-popover-size';
import { ModelFullscreen } from '@/client/components/workspace/model-dropdown/Fullscreen';
import type { HarnessSummary } from '@/shared/types/harness';

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
  /** The harness tab strip's data. Omitted by a picker that cannot spawn
   *  (the New Chat modal's preview), which then draws no tabs. */
  harnesses?: HarnessSummary[];
  activeHarness?: string | null;
  /** False while the open chat already has a transcript: switching the harness
   *  is a spawn-time choice, so the tab says so rather than changing the frame
   *  source under a running conversation. */
  harnessEditable?: boolean;
  onSelectHarness?: (harness: string) => void;
  onFixHarness?: (harness: string) => void;
  /** The active tab's harness has never been probed, so its model list is
   *  genuinely unknown rather than empty. */
  unprobedHarness?: boolean;
  /** Why the active tab cannot run (auth, missing binary), in the agent's words. */
  harnessBlocked?: string;
  /** Dismiss the full-screen picker. Required on a phone, where it owns the screen. */
  onClose?: () => void;
  /** Take the whole screen instead of hanging beside the trigger. Decided ONCE
   *  by the picker (`useFullscreenPicker`) and passed in, so the panel never
   *  holds a second answer to the same question. */
  fullscreen?: boolean;
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
  harnesses = [],
  activeHarness = null,
  harnessEditable = true,
  onSelectHarness,
  onFixHarness,
  unprobedHarness = false,
  harnessBlocked,
  onClose,
  fullscreen = false,
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

  const size = usePopoverSize(panelRef);

  /**
   * The card's CONTENT, shared by both placements.
   *
   * One tree, two frames: a sheet that re-implemented the list would be a second
   * picker that drifts (a new section, a new empty state, a new harness tab
   * landing in only one of them). Only the outer box and its constraints differ.
   */
  const card = (
    <>
      <div
          ref={panelRef}
          // The measured box belongs to the POPOVER placement only. The
          // full-screen frame owns both dimensions, so applying the popover's
          // width here left a 292px card floating inside a 390px screen and
          // truncated every model name to "A." (measured on a 390x844 phone).
          style={fullscreen ? undefined : { maxHeight: `${size.height}px`, width: `${size.width}px` }}
          // No `w-84 sm:w-96` here: width comes from `availableWidth` above, so
          // the panel tracks the composer it belongs to instead of the viewport
          // breakpoint.
          className={
            fullscreen
              // Full screen: no chrome of its own. A rounded, bordered card
              // floating inside an opaque full-screen frame draws a border that
              // belongs to nothing, so it drops both and lets the frame own the
              // edge.
              ? 'flex flex-1 min-h-0 flex-col overflow-hidden text-xs'
              : 'glass-popover bg-paper border border-ink/20 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs animate-in fade-in zoom-in-95 duration-100'
          }
        >
        {/* The harness tab strip sits ABOVE the search field: the tab changes
            what the list IS, so the search that follows applies to the list the
            tab selected. */}
        {harnesses.length > 0 && (
          <HarnessTabs
            harnesses={harnesses}
            active={activeHarness}
            editable={harnessEditable}
            onSelect={onSelectHarness ?? (() => {})}
            onFix={onFixHarness}
          />
        )}
        <ModelDropdownHeader
          search={search}
          onSearchChange={onSearchChange}
          onAddProvider={onAddProvider}
        />

        {/* Scrollable Model Lists. Deliberately no top padding: Chrome's
            sticky view rectangle is the scrollport's CONTENT box, so a
            `sticky top-0` heading inside a padded list pins below the padding
            and leaves that strip showing rows sliding above it (measured: a
            `p-1.5` list pinned its heading 6px down and `elementFromPoint` at
            2px returned a row). The first heading sits flush instead. */}
        <div
          className="flex-1 min-h-0 scrollbar-overlay-container px-1.5 pb-1.5 space-y-2"
          onMouseLeave={onMouseLeave}
          // The row under a resting pointer moves when the list scrolls; the
          // card follows it instead of staying where the hover started.
          onScroll={alignCardToRow}
        >
          {isLoading ? (
            <ModelDropdownSkeleton />
          ) : filteredModels.length === 0 ? (
            // Four empty states, and they mean different things. "No models"
            // for an agent that never answered would be a lie about its
            // catalog: an unprobed tab says so and offers the check, a blocked
            // tab quotes the agent, and only omp's own tab talks about providers.
            <div className="px-3 py-6 text-center text-ink/40">
              {search ? (
                <span className="italic">No models found matching &quot;{search}&quot;</span>
              ) : harnessBlocked ? (
                <span className="not-italic">{harnessBlocked}</span>
              ) : unprobedHarness ? (
                <span className="not-italic">
                  This harness has not reported its models yet.
                  <span className="mt-1 block text-[10px] text-ink/35">
                    Check its status in Settings → Harnesses.
                  </span>
                </span>
              ) : (
                <span className="italic">No models available for this harness.</span>
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
                harnessOfModel={activeHarness ?? undefined}
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
                harnessOfModel={activeHarness ?? undefined}
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
                  harnessOfModel={activeHarness ?? undefined}
                />
              ))}
            </>
          )}
        </div>

        {/* The footer is keyboard HINTS (`↑ ↓ navigate`, `Tab switch agent`,
            `← → thinking`). A phone has no keyboard, so in the full-screen
            placement it is three instructions the reader cannot follow, pinned
            over the rows. The popover keeps it: its reader is at a keyboard. */}
        {!fullscreen && <ModelDropdownFooter />}
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
    </>
  );

  // On a phone the picker owns the whole screen; a desktop keeps the popover.
  // `Fullscreen.tsx` states why each placement wins where it does, and why the
  // overlay must portal out of the composer's containing block.
  if (fullscreen) {
    return <ModelFullscreen open onClose={onClose ?? (() => {})}>{card}</ModelFullscreen>;
  }

  return (
    <div
      // Anchored to the trigger's LEFT edge, which is what the composer row
      // expects; the width cap above keeps it inside the panel.
      className="absolute bottom-full left-0 mb-2.5 z-50 flex items-start"
    >
      {card}
    </div>
  );
}
