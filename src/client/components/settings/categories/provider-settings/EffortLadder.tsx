import { Check } from 'lucide-preact';
import { PROVIDER_THINKING_EFFORTS, type ProviderThinkingEffort } from '@kabmo-labs/kabmo-provider-contracts/dialect';

interface EffortLadderProps {
  /** Selected levels, in any order; the component renders them in omp's order. */
  selected: ProviderThinkingEffort[];
  onToggle: (effort: ProviderThinkingEffort) => void;
  onSelectAll: () => void;
  onClear: () => void;
}

/**
 * The reasoning ladder a model accepts, as checkboxes.
 *
 * omp reads this as `thinking.efforts` and refuses to start a level that is not
 * on the list, so the control is a capability declaration rather than a
 * preference: ticking `low` and `high` means the model may be asked for those
 * two and nothing else. `off` is deliberately not offered — omp's `EffortSchema`
 * rejects it, and turning thinking off is a per-turn choice the chat composer
 * already owns.
 *
 * An EMPTY selection is a valid and distinct state: it means "do not declare a
 * ladder", which leaves omp on its own default for the model. That is why the
 * hint changes with the selection instead of always describing a ladder.
 */
export function EffortLadder({ selected, onToggle, onSelectAll, onClear }: EffortLadderProps) {
  const isAll = selected.length === PROVIDER_THINKING_EFFORTS.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-semibold text-ink">Reasoning levels</label>
        <div className="flex items-center gap-2 text-[10px]">
          <button
            type="button"
            onClick={onSelectAll}
            disabled={isAll}
            className="text-ink/50 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            all
          </button>
          <span className="text-ink/20">·</span>
          <button
            type="button"
            onClick={onClear}
            disabled={selected.length === 0}
            className="text-ink/50 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            none
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {PROVIDER_THINKING_EFFORTS.map((effort) => {
          const isOn = selected.includes(effort);
          return (
            <button
              key={effort}
              type="button"
              onClick={() => onToggle(effort)}
              aria-pressed={isOn}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-left text-[11px] transition-colors cursor-pointer ${
                isOn
                  ? 'border-ink/50 bg-ink/5 font-semibold text-ink'
                  : 'border-ink/15 hover:border-ink/30 text-ink/70'
              }`}
            >
              <span
                className={`w-3 h-3 rounded-[3px] border flex items-center justify-center shrink-0 ${
                  isOn ? 'border-ink bg-ink text-canvas' : 'border-ink/30'
                }`}
              >
                {isOn && <Check size={9} strokeWidth={3} />}
              </span>
              <span className="truncate">{effort}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[10px] text-ink/40 mt-1">
        {selected.length === 0
          ? 'No ladder declared — omp keeps its own default levels for this model.'
          : `Only these levels will be offered: ${PROVIDER_THINKING_EFFORTS.filter((e) => selected.includes(e)).join(', ')}.`}
      </p>
    </div>
  );
}
