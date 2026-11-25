import { useRef, useState } from 'preact/hooks';
import { Brain, Check, ChevronDown } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface ThinkingLevelDropdownProps {
  thinkingLevels: string[];
  currentThinking: string;
  onSelect: (level: string) => void;
  /** Too narrow for labels: the brain glyph alone, see `useComposerNarrow`. */
  iconOnly?: boolean;
}

export function ThinkingLevelDropdown({ thinkingLevels, currentThinking, onSelect, iconOnly = false }: ThinkingLevelDropdownProps) {
  const [showThinking, setShowThinking] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
  const listboxId = useRef(`thinking-listbox-${Math.random().toString(36).slice(2, 9)}`).current;
  useOnClickOutside(thinkingRef, () => setShowThinking(false));

  const handleSelect = (level: string) => {
    setShowThinking(false);
    onSelect(level);
  };

  return (
    <div className="relative" ref={thinkingRef}>
      <button
        onClick={() => thinkingLevels.length > 0 && setShowThinking(!showThinking)}
        disabled={thinkingLevels.length === 0}
        aria-label={`Thinking level: ${currentThinking}`}
        aria-haspopup="listbox"
        aria-expanded={showThinking}
        aria-controls={showThinking ? listboxId : undefined}
        className="tap-chip flex items-center space-x-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-ink/5 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
        title={thinkingLevels.length === 0 ? 'This model exposes no thinking levels' : `Thinking Level: ${currentThinking}`}
      >
        <Brain size={12} className="text-ink/60" />
        {!iconOnly && <span className="whitespace-nowrap">{currentThinking}</span>}
        <ChevronDown size={11} className={`flex-shrink-0 text-ink/40 transition-transform ${showThinking ? 'rotate-180' : ''}`} />
      </button>
      {showThinking && thinkingLevels.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Thinking level"
          className="glass-popover absolute bottom-full left-0 mb-1 w-40 bg-paper border border-ink/20 rounded-md shadow-lg z-50 py-1 text-xs"
        >
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-ink/40 font-semibold border-b border-ink/5 mb-1">Thinking Level</div>
          {thinkingLevels.map(level => (
            <button
              key={level}
              type="button"
              role="option"
              aria-selected={currentThinking === level}
              onClick={() => handleSelect(level)}
              className={`w-full text-left px-3 py-1.5 flex items-center justify-between transition-colors hover:bg-ink/5 ${
                currentThinking === level ? 'bg-ink/10 font-medium text-ink' : 'text-ink/75'
              }`}
            >
              <span>{level}</span>
              {currentThinking === level && <Check size={12} className="text-ink shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
