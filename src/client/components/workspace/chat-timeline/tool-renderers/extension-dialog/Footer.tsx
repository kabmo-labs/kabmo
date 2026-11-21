import { CornerDownLeft, X } from 'lucide-preact';

interface ExtensionDialogFooterProps {
  method: string;
  optionsLength: number;
  selectedOption: string | null;
  hasCustomAnswer?: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ExtensionDialogFooter({
  method,
  optionsLength,
  selectedOption,
  hasCustomAnswer = false,
  onCancel,
  onSubmit,
}: ExtensionDialogFooterProps) {
  const isSelectDisabled = method === 'select' && !selectedOption && !hasCustomAnswer;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 bg-canvas/40 px-5 py-3.5">
      {/* Keyboard hints */}
      <div className="flex items-center gap-2 font-mono text-[11px] text-ink/50">
        {method === 'select' && (
          <>
            <span className="hidden items-center gap-1 sm:inline-flex">
              <kbd className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink shadow-xs">
                1-{Math.min(9, optionsLength)}
              </kbd>
              <span className="text-ink/40">choose</span>
            </span>
            <span className="hidden text-ink/30 sm:inline">•</span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink shadow-xs">
                ↵
              </kbd>
              <span className="text-ink/40">select</span>
            </span>
          </>
        )}
        {method === 'confirm' && (
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink shadow-xs">
              ↵
            </kbd>
            <span className="text-ink/40">confirm</span>
          </span>
        )}
        {method === 'editor' && (
          <span className="inline-flex items-center gap-1">
            <kbd className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink shadow-xs">
              ⌘↵
            </kbd>
            <span className="text-ink/40">save buffer</span>
          </span>
        )}
        <span className="text-ink/30">•</span>
        <span className="inline-flex items-center gap-1">
          <kbd className="rounded border border-ink/15 bg-paper px-1.5 py-0.5 text-[10px] text-ink shadow-xs">
            Esc
          </kbd>
          <span className="text-ink/40">cancel</span>
        </span>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2.5 ml-auto">
        <button
          type="button"
          onClick={onCancel}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-ink/15 bg-paper px-3.5 py-1.5 text-[12px] font-medium text-ink/70 transition-colors hover:border-ink/30 hover:bg-canvas/50 hover:text-ink"
        >
          <X size={12} className="opacity-60" />
          <span>Cancel</span>
        </button>

        <button
          type="button"
          onClick={onSubmit}
          disabled={isSelectDisabled}
          className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-ink px-4 py-1.5 text-[12px] font-semibold text-paper shadow-xs transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <span>
            {method === 'confirm'
              ? 'Confirm'
              : method === 'select'
                ? 'Select Option'
                : 'Submit Response'}
          </span>
          <CornerDownLeft size={12} className="opacity-70" />
        </button>
      </div>
    </div>
  );
}
