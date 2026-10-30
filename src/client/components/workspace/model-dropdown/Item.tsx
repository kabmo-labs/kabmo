import type { TargetedMouseEvent } from 'preact';
import { Brain, Command, GripVertical, Star } from 'lucide-preact';
import type { AIModelOption } from '@/shared/types';
import { formatContextWindow } from '@/shared/lib/code/format';
import { ProviderIconPlate } from '@/client/components/common/provider-icon/Plate';

interface ModelDropdownItemProps {
  model: AIModelOption;
  /** Identity of THIS row (`section::provider:id`); the specs card anchors to it. */
  rowId: string;
  /**
   * Draw the provider tag. Set for a rail row whose model name is served by
   * more than one provider — FAVORITES and RECENT have no provider header, so
   * without the tag `DeepSeek V4 Pro` under `deepseek` and under `kenari` are
   * two identical rows.
   */
  showProvider?: boolean;
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
  rowId,
  showProvider = false,
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
      // by `rowId` — the section PLUS the composite model key. The model key
      // alone is ambiguous: a favorite is drawn in the rail and again in its
      // provider section, so the card (and the hover index) resolved to the
      // first of the two and described a row three rows away.
      data-picker-row={rowId}
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
          title={showProvider ? `${model.name} · ${model.provider}` : model.name}
        >
          {model.name}
        </span>
      </div>

      {/* Trailing cells in the reader's order: context number → thinking preset →
          provider tag → star. The star is last because it is the one control on
          every row and has to stay on the row's edge.
          The check that used to live here is gone: selection is already the
          row's tint and its semibold name, and the checkmark was the only thing
          whose presence changed this cluster's width.
          The number is no longer a column: it is the FIRST cell of a cluster
          that is right-aligned, so its x moves with the width of the pill and
          the tag to its right (measured over the seeded catalog: `626` on rows
          with neither, down to `519` where both are present). The order is the
          reader's, the alignment is the price.
          On a tagged row at phone width the number yields instead of the name:
          the row is 322px there, the tag costs 43-53px, and the name would have
          collapsed to `Deepse…` (measured: 37px of a 99px name). Identity
          outranks the context number on the one row whose identity is in
          question. */}
      <div className="flex items-center justify-end gap-1.5 flex-shrink-0">
        <span
          className={`w-11 shrink-0 text-right font-mono text-[10px] tabular-nums text-ink/45 ${
            showProvider ? 'max-sm:hidden' : ''
          }`}
        >
          {model.contextWindow ? formatContextWindow(model.contextWindow) : ''}
        </span>

        {model.thinkingLevel && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCycleThinking?.(model, e);
            }}
            title={`Thinking preset: ${model.thinkingLevel} (Click or use ← / → to change)`}
            className="inline-flex shrink-0 items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono text-ink/70 bg-ink/5 hover:bg-ink/10 border border-ink/10 transition-colors cursor-pointer"
          >
            <Brain size={10} className="text-ink/50" />
            <span>{model.thinkingLevel}</span>
          </button>
        )}

        {/* The provider tag, drawn only on a rail row whose name is shared by
            another provider so the two rows are not identical. It never shrinks
            and never wraps: `kenari` and `kenari-jatis` are two accounts, so an
            ellipsis here would make them render identically — the same rule the
            composer trigger follows. */}
        {showProvider && (
          <span
            className="shrink-0 whitespace-nowrap rounded border border-ink/15 bg-ink/5 px-1 font-mono text-[9px] leading-4 text-ink/55"
            title={`Provider: ${model.provider}`}
          >
            {model.provider}
          </span>
        )}

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
