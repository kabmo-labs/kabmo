import type { RefObject } from 'preact/compat';
import { CheckCircle2, Circle } from 'lucide-preact';

interface ExtensionDialogSelectBodyProps {
  options: string[];
  optionDetails: { description?: string }[];
  selectedOption: string | null;
  customValue: string;
  onCustomChange: (value: string) => void;
  customInputRef: RefObject<HTMLInputElement>;
  onSelect: (option: string) => void;
  onConfirmOption: (option: string) => void;
  /**
   * Hide the free-text "Other" field.
   *
   * The field exists for an `ask` question, whose option list ends in
   * "Other (type your own)" — a prompt to type an answer. omp's APPROVAL
   * gate offers no such option: its choices are "Approve" and "Deny", and
   * omp's own answer parser (`approvalAnswerForChoice`) treats ANY other
   * string as a DENY. So a free-text field on a gate is a way to deny the
   * call by typing near-miss text ("ok", "sure", "yep") and never to approve
   * it — measured: "Approve" → allow, "yes please" → deny.
   */
  hideCustomAnswer?: boolean;
}

export function ExtensionDialogSelectBody({
  options,
  optionDetails,
  selectedOption,
  customValue,
  onCustomChange,
  customInputRef,
  onSelect,
  onConfirmOption,
  hideCustomAnswer = false,
}: ExtensionDialogSelectBodyProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[11px] font-medium tracking-wider text-ink/50 uppercase">
        <span>Available Options</span>
        <span className="font-mono text-[10px] text-ink/40">Press [1-{Math.min(9, options.length)}] to choose</span>
      </div>
      <div className="grid gap-2" role="radiogroup">
        {options.map((option, index) => {
          const isSelected = selectedOption === option;
          const detail = optionDetails[index]?.description;

          return (
            <button
              key={option}
              type="button"
              onClick={() => onSelect(option)}
              onDblClick={() => onConfirmOption(option)}
              aria-checked={isSelected}
              role="radio"
              className={`group flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                isSelected
                  ? 'border-ink bg-paper shadow-sm ring-1 ring-ink/10'
                  : 'border-ink/10 bg-canvas/30 hover:border-ink/25 hover:bg-paper'
              }`}
            >
              {/* Shortcut key indicator */}
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? 'bg-ink text-paper'
                    : 'border border-ink/15 bg-paper text-ink/60 group-hover:border-ink/30 group-hover:text-ink'
                }`}
              >
                {index + 1}
              </span>

              {/* Option label & description */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[13px] font-medium leading-snug ${isSelected ? 'text-ink font-semibold' : 'text-ink/85'}`}>
                    {option}
                  </span>
                </div>
                {detail && (
                  <div className="mt-1 text-[11.5px] leading-relaxed text-ink/55">
                    {detail}
                  </div>
                )}
              </div>

              {/* Status Radio / Check */}
              <span className="mt-0.5 shrink-0">
                {isSelected ? (
                  <CheckCircle2 size={16} className="text-ink" />
                ) : (
                  <Circle size={16} className="text-ink/20 group-hover:text-ink/40" />
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Free-text answer for "Other"-style options: typing here wins over the
          highlighted option, since the literal option text is not an answer.
          An approval gate has no "Other" option, so it draws no field. */}
      {!hideCustomAnswer && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[11px] font-medium tracking-wider text-ink/50 uppercase">Other — type your own answer</div>
          <input
            ref={customInputRef}
            type="text"
            value={customValue}
            placeholder="Type a custom answer and press Enter..."
            onChange={(e) => onCustomChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (customValue.trim()) onConfirmOption(customValue.trim());
              }
            }}
            className="w-full rounded-xl border border-ink/15 bg-paper px-4 py-3 text-[13.5px] text-ink placeholder:text-ink/35 outline-none transition-all focus:border-ink focus:ring-2 focus:ring-ink/15"
          />
        </div>
      )}
    </div>
  );
}
