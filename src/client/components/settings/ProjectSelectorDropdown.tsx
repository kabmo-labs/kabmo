import { useRef, useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import { Check, ChevronDown, Folder } from 'lucide-preact';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

export interface ProjectOption {
  id: string;
  /** Label used by the default variant and the trigger's name lookup. */
  name: string;
  /** Label used by the compact (skill) variant. */
  label: string;
  /** Value passed to `onChangeProject`; defaults to `id`. */
  value?: string;
}

const optionValue = (option: ProjectOption): string => option.value ?? option.id;

/**
 * Trigger label for a selected value. A caller that stores the option's VALUE
 * (the skills/commands panels store a project path, not an id) must still get
 * the option's human label rather than the raw path it selected.
 */
const defaultTriggerLabel = (options: ProjectOption[], selectedProject: string): string =>
  options.find((option) => option.id === selectedProject || optionValue(option) === selectedProject)?.name
  ?? selectedProject;

interface ProjectSelectorDropdownProps {
  selectedProject: string;
  onChangeProject: (value: string) => void;
  /**
   * The real workspace folders (`useWorkspaceRoots`). Defaults to NONE: this
   * used to fall back to a hardcoded list of made-up projects, so a panel that
   * forgot to pass its options offered scopes that resolved to nothing.
   */
  options?: ProjectOption[];
  /** Trigger label resolver; defaults to a `name` lookup by value. */
  getTriggerLabel?: (options: ProjectOption[], selectedProject: string) => string;
  /** Compact styling used by the skill sidebar (label + check, backdrop). */
  variant?: 'default' | 'compact';
}

/**
 * The project selector that sits at the top of every settings sidebar. The
 * `default` variant matches the agent/command/MCP markup; `compact` keeps the
 * skill sidebar's tighter padding, label wording, and check-mark styling.
 */
export const ProjectSelectorDropdown: FunctionComponent<ProjectSelectorDropdownProps> = ({
  selectedProject,
  onChangeProject,
  options = [],
  getTriggerLabel = defaultTriggerLabel,
  variant = 'default',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useOnClickOutside(dropdownRef, () => setIsOpen(false));

  const label = getTriggerLabel(options, selectedProject);

  const optionButtons = options.map((option) => {
    const value = optionValue(option);
    const isSelected = selectedProject === value;
    return (
      <button
        key={option.id}
        type="button"
        onClick={() => {
          onChangeProject(value);
          setIsOpen(false);
        }}
        className={
          variant === 'compact'
            ? `w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-ink/5 transition-colors cursor-pointer ${
                isSelected ? 'text-ink font-semibold bg-ink/5' : 'text-ink/70'
              }`
            : `w-full px-3 py-1.5 text-left text-xs flex items-center justify-between hover:bg-ink/5 transition-colors cursor-pointer ${
                isSelected ? 'font-semibold text-ink bg-ink/5' : 'text-ink/80'
              }`
        }
      >
        {variant === 'compact' ? (
          <>
            <span className="truncate">{option.label}</span>
            {isSelected && <Check size={12} className="text-ink flex-shrink-0" />}
          </>
        ) : (
          <div className="flex items-center gap-2 truncate">
            <Folder size={13} className="text-ink/60" />
            <span className="truncate">{option.name}</span>
          </div>
        )}
      </button>
    );
  });

  // No projects at all: the trigger says why instead of opening an empty menu
  // (or, worse, naming a scope that does not exist).
  if (options.length === 0) {
    return (
      <div className={variant === 'compact' ? 'p-2.5 border-b border-ink/10' : 'p-3 border-b border-ink/10'}>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed border-ink/15 text-[11px] text-ink/50">
          <Folder size={13} className="text-ink/40 flex-shrink-0" />
          <span className="truncate">No projects yet — add one in Settings → Projects</span>
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="p-2.5 border-b border-ink/10 relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper text-xs text-ink transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 truncate">
            <Folder size={14} className="text-ink/60 flex-shrink-0" />
            <span className="truncate font-medium">{label}</span>
          </div>
          <ChevronDown size={14} className="text-ink/50 flex-shrink-0" />
        </button>

        {isOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setIsOpen(false)} />
            <div className="glass-popover absolute left-2.5 right-2.5 top-12 z-30 bg-paper border border-ink/15 rounded-lg shadow-lg py-1 animate-in fade-in zoom-in-95 duration-100">
              {optionButtons}
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-ink/10 relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs"
      >
        <div className="flex items-center gap-2 truncate">
          <Folder size={14} className="text-ink/60 flex-shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <ChevronDown size={14} className="text-ink/50 flex-shrink-0" />
      </button>

      {isOpen && (
        <div className="glass-popover absolute top-12 left-3 right-3 bg-paper border border-ink/20 rounded-lg shadow-lg z-30 py-1 divide-y divide-ink/5 animate-in fade-in zoom-in-95 duration-100">
          {optionButtons}
        </div>
      )}
    </div>
  );
};
