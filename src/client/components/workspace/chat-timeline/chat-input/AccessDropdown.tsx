import { useRef, useState } from 'preact/hooks';
import { Check, ChevronDown, LockKeyhole } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { APPROVAL_MODES } from '@/shared/lib/omp/config/access-mode';
import { accessLevelCopy } from '@/client/components/workspace/chat-timeline/chat-input/access-levels';

export interface AccessDropdownProps {
  value: ApprovalMode;
  onSelect: (mode: ApprovalMode) => void;
  /**
   * The harness this composer runs (or will run). The tier means something
   * narrower on an ACP agent — it answers the approvals the agent raises
   * instead of gating the tools itself — so the copy follows the harness.
   */
  harness?: string;
  /**
   * The composer is too narrow for labels (see `useComposerNarrow`), so the
   * chip keeps its lock glyph and drops its words. A flag rather than a
   * container query: the same verdict decides which ROW hosts Plan/Goal, and a
   * second mechanism for one fact is how the chip and its neighbour disagreed.
   */
  iconOnly?: boolean;
}

export function AccessDropdown({ value, onSelect, harness, iconOnly = false }: AccessDropdownProps) {
  const [showAccess, setShowAccess] = useState(false);
  const accessRef = useRef<HTMLDivElement>(null);
  const listboxId = useRef(`access-listbox-${Math.random().toString(36).slice(2, 9)}`).current;
  useOnClickOutside(accessRef, () => setShowAccess(false));
  const copy = accessLevelCopy(harness);

  // Selection is owned by ChatInput; this dropdown only reports user choices.
  const handleSelect = (mode: ApprovalMode) => {
    onSelect(mode);
    setShowAccess(false);
  };

  return (
    <div className="relative" ref={accessRef}>
      <button
        type="button"
        onClick={() => setShowAccess(!showAccess)}
        aria-label={`Access control: ${copy.labels[value]}`}
        aria-haspopup="listbox"
        aria-expanded={showAccess}
        aria-controls={showAccess ? listboxId : undefined}
        className="tap-chip flex items-center space-x-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink"
      >
        <LockKeyhole size={12} className="text-ink/60" />
        {/* The label is dropped whole below the composer's label width — never
            clipped to a letter and never allowed to wrap: `whitespace-nowrap`
            is what kept `Always ask` off two lines, and the flag is what keeps
            the row from being squeezed into overlap. */}
        {!iconOnly && <span className="whitespace-nowrap">{copy.labels[value]}</span>}
        <ChevronDown size={11} className={`flex-shrink-0 text-ink/40 transition-transform ${showAccess ? 'rotate-180' : ''}`} />
      </button>
      {showAccess && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Access control"
          className={`glass-popover absolute bottom-full left-0 mb-1 ${copy.note ? 'w-56' : 'w-40'} bg-paper border border-ink/20 rounded-md shadow-lg z-50 py-1 text-xs`}
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold border-b border-ink/5 mb-1">Access Control</div>
          {APPROVAL_MODES.map(mode => (
            <button
              key={mode}
              type="button"
              role="option"
              aria-selected={value === mode}
              onClick={() => handleSelect(mode)}
              title={copy.descriptions[mode]}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors hover:bg-ink/5 ${
                value === mode ? 'bg-ink/10 font-medium text-ink' : 'text-ink/75'
              }`}
            >
              <span>{copy.labels[mode]}</span>
              {value === mode && <Check size={12} className="text-ink shrink-0" />}
            </button>
          ))}
          {copy.note && (
            <p className="px-3 pt-1.5 pb-1 text-[10px] leading-snug text-ink/45 border-t border-ink/10 mt-1">
              {copy.note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
