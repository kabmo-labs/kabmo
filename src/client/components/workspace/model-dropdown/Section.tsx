import type { TargetedMouseEvent } from 'preact';
import { ChevronDown, ChevronUp, History, Star } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { ModelDropdownItem } from '@/client/components/workspace/model-dropdown/Item';
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
  /** Composite key → index in the keyboard-navigation flat list. */
  modelIndex: Record<string, number>;
  focusedIndex: number;
  onSelect: (model: AIModelOption) => void;
  onToggleFavorite: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onCycleThinking: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onHoverItem: (index: number, model: AIModelOption) => void;
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
  focusedIndex,
  onSelect,
  onToggleFavorite,
  onCycleThinking,
  onHoverItem,
}: ModelDropdownSectionProps) {
  if (models.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {/* The header shares the row grid — a fixed grip slot, then the plate at
          the same size the rows use — so a section title starts at the same x
          as the model names under it. It used to start at its own icon's edge,
          which left the title a few pixels left of every row beneath. */}
      <button
        type="button"
        onClick={() => onToggleCollapse(id)}
        className="w-full flex items-center justify-between gap-2 pl-1 pr-2 py-1 text-[11px] font-semibold text-ink/60 uppercase tracking-wider hover:text-ink cursor-pointer select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-3 shrink-0" aria-hidden="true" />
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
        {isCollapsed ? (
          <ChevronDown size={12} className="text-ink/40 shrink-0" />
        ) : (
          <ChevronUp size={12} className="text-ink/40 shrink-0" />
        )}
      </button>

      {!isCollapsed && (
        <div className="space-y-0.5">
          {models.map((m) => {
            // Identity is provider + id: the same model id is served by several
            // providers, so an id-only match would focus/select their rows too.
            const key = modelKey(m);
            const index = modelIndex[key] ?? -1;
            return (
              <ModelDropdownItem
                key={`${id}-${key}`}
                model={m}
                isSelected={selectedModelKey === key}
                isFocused={focusedIndex === index}
                onSelect={onSelect}
                onToggleFavorite={onToggleFavorite}
                onCycleThinking={onCycleThinking}
                onMouseEnter={() => onHoverItem(index, m)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
