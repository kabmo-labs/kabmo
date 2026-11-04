import { useRef, useState } from 'preact/hooks';
import { Brain, Check } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

interface ThinkingLevelDropdownProps {
  thinkingLevels: string[];
  currentThinking: string;
  onSelect: (level: string) => void;
}

export function ThinkingLevelDropdown({ thinkingLevels, currentThinking, onSelect }: ThinkingLevelDropdownProps) {
  const [showThinking, setShowThinking] = useState(false);
  const thinkingRef = useRef<HTMLDivElement>(null);
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
        className="flex items-center space-x-1 hover:bg-ink/5 px-2 py-1 rounded transition-colors text-xs text-ink/80 disabled:opacity-40 disabled:cursor-not-allowed"
        title={thinkingLevels.length === 0 ? 'This model exposes no thinking levels' : `Thinking Level: ${currentThinking}`}
      >
        <Brain size={12} className="text-ink/60" />
        <span className="hidden lg:inline">{currentThinking}</span>
      </button>
      {showThinking && thinkingLevels.length > 0 && (
        <div className="glass-popover absolute bottom-full left-0 mb-1 w-40 bg-paper border border-ink/20 rounded-md shadow-lg z-50 py-1 text-xs">
          <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-ink/40 font-semibold mb-1">Thinking Level</div>
          {thinkingLevels.map(level => (
            <button
              key={level}
              onClick={() => handleSelect(level)}
              className="w-full text-left px-3 py-1.5 hover:bg-ink/5 flex items-center justify-between transition-colors"
            >
              <span>{level}</span>
              {currentThinking === level && <Check size={12} className="text-ink" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
