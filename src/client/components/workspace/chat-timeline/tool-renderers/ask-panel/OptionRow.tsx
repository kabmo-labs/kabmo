/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One choice of an `ask` question: the mark, the label, omp's own
 * `description`, and the badge for the choice omp marks as the default.
 *
 * SHARED by both of omp's shapes for the tool — the per-question `select` loop
 * (`FrameControl`) and the grouped frame (`GroupedAsk`) — because the two had
 * written the row twice and drifted: the grouped card rendered the description
 * only as a `title` tooltip, so the tradeoff omp writes for every choice was
 * invisible until hovered, and invisible entirely on a phone. A question reads
 * the same in both shapes or it is two features.
 *
 * `description` is VISIBLE text, never a tooltip. omp's `ask` prompt tells the
 * model to put the tradeoff there ("short labels, tradeoffs in `description`"),
 * so it is the half of the option that carries the decision — a row that hides
 * it asks the user to pick blind.
 */

interface OptionRowProps {
  label: string;
  description?: string;
  /** Several options can be picked at once, so the mark is a checkbox. */
  multi?: boolean;
  checked?: boolean;
  /** omp marks this choice as its default (`recommended`). */
  suggested?: boolean;
  /** A submit is on the wire — the row stays visible but inert. */
  disabled?: boolean;
  /**
   * The row that ENDS a multi-select sweep ("Done") rather than being an answer.
   * Drawn heavier than an ordinary row, since picking it submits instead of
   * toggling.
   */
  emphasis?: boolean;
  onClick: () => void;
}

export function OptionRow({
  label,
  description,
  multi,
  checked,
  suggested,
  disabled,
  emphasis,
  onClick,
}: OptionRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full cursor-pointer items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11.5px] transition-colors disabled:cursor-default ${
        checked
          ? 'border-ink/30 bg-ink/5 text-ink'
          : emphasis
            ? 'border-ink/20 bg-canvas/60 font-medium text-ink hover:border-ink/40'
            : 'border-ink/8 bg-canvas/30 text-ink/80 hover:border-ink/25 hover:bg-ink/5 hover:text-ink'
      }`}
    >
      <span
        className={`mt-1 h-3 w-3 shrink-0 ${multi ? 'rounded-[3px]' : 'rounded-full'} border ${
          checked ? 'border-ink bg-ink' : 'border-ink/30'
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-medium">
          <span className="truncate">{label}</span>
          {suggested && (
            <span className="shrink-0 rounded-full bg-ink/5 px-1.5 py-px font-mono text-[9px] uppercase tracking-wider text-ink/45">
              suggested
            </span>
          )}
        </span>
        {description && (
          <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink/50">{description}</span>
        )}
      </span>
    </button>
  );
}
