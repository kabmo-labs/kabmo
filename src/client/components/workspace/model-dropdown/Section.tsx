import type { TargetedMouseEvent } from 'preact';
import { ChevronDown, ChevronUp, History, Star } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { ModelDropdownItem } from '@/client/components/workspace/model-dropdown/Item';
import { normalizedModelName, rowIdFor } from '@/client/components/workspace/model-dropdown/groups';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';
import { modelKey } from '@/shared/lib/models/identity';

interface ModelDropdownSectionProps {
  id: string;
  title: string;
  iconType?: 'star' | 'recent' | 'provider';
  models: AIModelOption[];
  isCollapsed: boolean;
  onToggleCollapse: (id: string) => void;
  /** Composite (`provider:id`) key of the active selection. */
  selectedModelKey: string;
  /** Row id (`section::provider:id`) → index in the keyboard-navigation flat list. */
  modelIndex: Record<string, number>;
  /** Lower-cased model names served by more than one provider. */
  ambiguousNames: ReadonlySet<string>;
  focusedIndex: number;
  onSelect: (model: AIModelOption) => void;
  onToggleFavorite: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onCycleThinking: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  /** Row index in the flat list; the panel resolves it to the row it renders. */
  onHoverItem: (index: number) => void;
}

export function ModelDropdownSection({
  id,
  title,
  iconType = 'provider',
  models,
  isCollapsed,
  onToggleCollapse,
  selectedModelKey,
  modelIndex,
  ambiguousNames,
  focusedIndex,
  onSelect,
  onToggleFavorite,
  onCycleThinking,
  onHoverItem,
}: ModelDropdownSectionProps) {
  if (models.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {/* The header starts IN the row's grip column, not after it: its mark
          occupies the 18px slot the rows keep for the drag handle, so the
          provider logo centres on that handle, and the title then starts on the
          column the rows draw their own plate in. The title is therefore a
          column LEFT of the model names — deliberately not aligned with them,
          which is what makes the two marks read as one column. */}
      <button
        type="button"
        onClick={() => onToggleCollapse(id)}
        className="w-full flex items-center justify-between gap-2 pl-1 pr-2 py-1 text-[11px] font-semibold text-ink/60 uppercase tracking-wider hover:text-ink cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          {iconType === 'star' && (
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0">
              <Star size={12} className="fill-sky-400 text-sky-400" />
            </span>
          )}
          {iconType === 'recent' && (
            <span className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0">
              <History size={12} className="text-ink/60" />
            </span>
          )}
          {iconType === 'provider' && (
            // The section's own provider, taken from a row rather than the
            // uppercased group key, so the mark resolves off the real slug —
            // and its fetched web icon, when the server has one.
            <ProviderIconPlate
              provider={{
                icon: models[0]?.providerIcon,
                slug: models[0]?.provider ?? id,
                name: models[0]?.provider ?? id,
                ...(models[0]?.providerIconUrl ? { iconUrl: models[0].providerIconUrl } : {}),
              }}
              size={18}
            />
          )}
          <span className="min-w-0 truncate">{title}</span>
        </div>
        {/* The same slot a row's favourite star occupies — `p-1` around a 13px
            mark — so the disclosure chevron sits on the stars' axis. A bare
            icon was flush against the panel edge, 4.5px right of every star
            below it (measured: chevron centre 675, star centre 670.5). */}
        <span className="inline-flex items-center justify-center p-1 shrink-0 text-ink/40">
          {isCollapsed ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
        </span>
      </button>

      {!isCollapsed && (
        <div className="space-y-0.5">
          {models.map((m) => {
            // Identity is per ROW, not per model: the same model id is served
            // by several providers, and one model is drawn in a rail AND in its
            // provider section. `section::provider:id` keeps every row's hover
            // index and specs anchor its own.
            const rowId = rowIdFor(id, m);
            const index = modelIndex[rowId] ?? -1;
            return (
              <ModelDropdownItem
                key={rowId}
                rowId={rowId}
                model={m}
                // A rail has no provider heading above it, so a name shared by
                // two providers would render twice identically. A provider
                // section already says the provider in its header.
                showProvider={iconType !== 'provider' && ambiguousNames.has(normalizedModelName(m))}
                isSelected={selectedModelKey === modelKey(m)}
                isFocused={focusedIndex === index}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
                onCycleThinking={onCycleThinking}
                onMouseEnter={() => onHoverItem(index)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
