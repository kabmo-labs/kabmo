import { useRef, useState } from 'preact/hooks';
import { Check, LockKeyhole } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { APPROVAL_MODES } from '@/shared/lib/omp/config/access-mode';
import { ACCESS_LEVEL_DESCRIPTIONS, ACCESS_LEVEL_LABELS } from '@/client/components/workspace/chat-timeline/chat-input/access-levels';

export interface AccessDropdownProps {
  value: ApprovalMode;
  onSelect: (mode: ApprovalMode) => void;
}

export function AccessDropdown({ value, onSelect }: AccessDropdownProps) {
  const [showAccess, setShowAccess] = useState(false);
  const accessRef = useRef<HTMLDivElement>(null);
  useOnClickOutside(accessRef, () => setShowAccess(false));

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
        className="flex items-center space-x-1 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-ink/80"
      >
        <LockKeyhole size={12} className="text-ink/60" />
        <span className="hidden lg:inline">{ACCESS_LEVEL_LABELS[value]}</span>
      </button>
      {showAccess && (
        <div className="glass-popover absolute bottom-full left-0 mb-1 w-40 bg-paper border border-ink/20 rounded-md shadow-lg z-50 py-1 text-xs">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink/40 font-semibold mb-1">Access Control</div>
          {APPROVAL_MODES.map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSelect(mode)}
              title={ACCESS_LEVEL_DESCRIPTIONS[mode]}
              className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center justify-between transition-colors"
            >
              <span>{ACCESS_LEVEL_LABELS[mode]}</span>
              {value === mode && <Check size={12} className="text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
