import type { TargetedMouseEvent } from 'preact';
import { Brain, Check, Command, GripVertical, Star } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { formatContextWindow } from '@/shared/lib/code/format';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';
import { modelKey } from '@/shared/lib/models/identity';

interface ModelDropdownItemProps {
  model: AIModelOption;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (model: AIModelOption) => void;
  onToggleFavorite: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onCycleThinking?: (model: AIModelOption, e: TargetedMouseEvent<HTMLElement>) => void;
  onMouseEnter: () => void;
}

/**
 * One model row in the composer's picker.
 *
 * The row is a GRID so the names line up down the list: a fixed grip slot, a
 * fixed plate, a name that takes the slack, and a fixed right-aligned context
 * column. Before, the mark was a raw 13px icon — an SVG for a brand, a
 * text-width pill for the initials fallback — so every row's name started at a
 * different x, and the context badge floated against whatever the name's length
 * happened to be. A provider's own web icon is drawn in colour on the plate
 * (see `ProviderIconPlate`); everything else stays monochrome.
 */
export function ModelDropdownItem({
  model,
  isSelected,
  isFocused,
  onSelect,
  onToggleFavorite,
  onCycleThinking,
  onMouseEnter,
}: ModelDropdownItemProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      // The specs card anchors to the row it describes, and it finds that row
      // by this key — the same composite identity the picker navigates by, so
      // the mouse and the keyboard resolve to one anchor.
      data-model-key={modelKey(model)}
      onClick={() => onSelect(model)}
      onMouseEnter={onMouseEnter}
      className={`group relative w-full flex items-center justify-between gap-2 pl-1 pr-2 py-1.5 rounded-lg text-xs transition-colors cursor-pointer select-none ${
        isFocused
          ? 'bg-ink/10 text-ink'
          : isSelected
            ? 'bg-ink/5 text-ink'
            : 'text-ink/85 hover:bg-ink/5'
      }`}
    >
      {/* Left: drag handle, plate, name, context. The grip keeps its own fixed
          slot so a hover-only affordance cannot move the name — and that slot is
          the SAME 18px column as the plate, so the section header's mark (which
          sits in this column) centres on the grip and the header's title starts
          on the row's plate. */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="inline-flex items-center justify-center w-[18px] h-[18px] shrink-0">
          <GripVertical
            size={12}
            className="text-ink/20 group-hover:text-ink/50 transition-colors"
          />
        </span>

        {model.isCmdAgent ? (
          <span
            className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-[5px] border border-ink/20 bg-ink/5 text-ink/80 flex-shrink-0"
            title="Autonomous Agent Command Mode [CMD]"
          >
            <Command size={10} />
          </span>
        ) : (
          <ProviderIconPlate
            provider={{
              icon: model.providerIcon,
              slug: model.provider,
              name: model.provider,
              ...(model.providerIconUrl ? { iconUrl: model.providerIconUrl } : {}),
            }}
            size={18}
          />
        )}

        {model.isCmdAgent && (
          <span className="font-mono text-[11px] font-semibold text-ink/75 flex-shrink-0">
            [CMD]
          </span>
        )}
        <span
          className={`flex-1 min-w-0 truncate ${
            isSelected ? 'font-semibold text-ink' : 'font-normal text-ink/90'
          }`}
          title={model.name}
        >
          {model.name}
        </span>
        {/* Fixed column: a number has to be comparable down the list, and a
            badge that follows the name cannot be. */}
        <span className="w-11 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink/45">
          {model.contextWindow ? formatContextWindow(model.contextWindow) : ''}
        </span>
      </div>

      {/* Right: thinking pill, checkmark, star.
          A FIXED width, right-aligned: the pill's label and the checkmark's
          presence both change this cluster's width, which moved the context
          column 25px to the left on the one selected row (measured: 547 vs 572).
          Reserving the whole cluster pins that column, and the star — the one
          control on every row — stays on the row's edge. */}
      <div className="flex items-center justify-end gap-1.5 flex-shrink-0 w-[100px]">
        {model.thinkingLevel && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCycleThinking?.(model, e);
            }}
            title={`Thinking preset: ${model.thinkingLevel} (Click or use ← / → to change)`}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-ink/70 bg-ink/5 hover:bg-ink/10 border border-ink/10 transition-colors cursor-pointer"
          >
            <Brain size={10} className="text-ink/50" />
            <span>{model.thinkingLevel}</span>
          </button>
        )}

        {isSelected && <Check size={13} className="text-ink flex-shrink-0" />}

        <button
          type="button"
          onClick={(e) => onToggleFavorite(model, e)}
          title={model.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          className="p-1 rounded text-ink/30 hover:text-sky-400 hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Star
            size={13}
            className={model.isFavorite ? 'fill-sky-400 text-sky-400' : 'text-ink/30 hover:text-sky-400'}
          />
        </button>
      </div>
    </div>
  );
}
