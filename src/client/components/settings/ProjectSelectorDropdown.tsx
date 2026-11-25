import { Folder } from 'lucide-preact';
import { SETTINGS_BAND, SETTINGS_BAND_HEIGHT } from '@/client/components/settings/pane-header';
import { SearchSelect } from '@/client/components/common/search-select';

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
  /** Compact styling used by the skill sidebar. */
  variant?: 'default' | 'compact';
}

/** The two trigger skins the settings bands already draw. */
const TRIGGER_DEFAULT =
  'w-full flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper text-ink text-xs font-medium transition-colors cursor-pointer shadow-2xs focus:outline-none focus:border-ink/50';
const TRIGGER_COMPACT =
  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 bg-paper text-xs text-ink transition-colors cursor-pointer focus:outline-none focus:border-ink/50';

/**
 * The project selector that sits at the top of every settings sidebar.
 *
 * One `SearchSelect` with the band's own trigger chrome: a workspace list is a
 * catalog (it grows with every folder), so it is searchable like every other
 * catalog in this app. The `default` variant matches the agent/command/MCP
 * markup; `compact` keeps the skill sidebar's tighter padding and label wording.
 */
export const ProjectSelectorDropdown = ({
  selectedProject,
  onChangeProject,
  options = [],
  getTriggerLabel = defaultTriggerLabel,
  variant = 'default',
}: ProjectSelectorDropdownProps) => {
  const label = getTriggerLabel(options, selectedProject);
  const rows = options.map((option) => ({
    value: optionValue(option),
    label: variant === 'compact' ? option.label : option.name,
  }));
  // The stored value may be an id while the caller resolves a path to it; the
  // row that MATCHES is the one the check belongs on.
  const selectedRow = options.find(
    (option) => optionValue(option) === selectedProject || option.id === selectedProject,
  );

  // No projects at all: the trigger says why instead of opening an empty menu
  // (or, worse, naming a scope that does not exist).
  if (options.length === 0) {
    return (
      <div
        className={`${SETTINGS_BAND} relative ${variant === 'compact' ? 'px-2.5' : 'px-3'}`}
        style={{ height: SETTINGS_BAND_HEIGHT }}
      >
        <div className="flex w-full items-center gap-2 px-2.5 py-1.5 rounded-lg border border-dashed border-ink/15 text-[11px] text-ink/50">
          <Folder size={13} className="text-ink/40 flex-shrink-0" />
          <span className="truncate">No projects yet. Add one in Settings, Projects</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${SETTINGS_BAND} relative ${variant === 'compact' ? 'px-2.5' : 'px-3'}`}
      style={{ height: SETTINGS_BAND_HEIGHT }}
    >
      <SearchSelect
        value={selectedRow ? optionValue(selectedRow) : ''}
        options={rows}
        triggerLabel={label}
        placeholder="Select a project"
        ariaLabel="Project scope"
        onChange={onChangeProject}
        allowEmpty={false}
        heading="Project"
        searchPlaceholder="Search projects…"
        icon={() => <Folder size={14} className="text-ink/60 flex-shrink-0" />}
        triggerClassName={variant === 'compact' ? TRIGGER_COMPACT : TRIGGER_DEFAULT}
      />
    </div>
  );
};
