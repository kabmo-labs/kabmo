import type { ComponentChildren } from 'preact';
import type { FunctionComponent } from 'preact/compat';
import { Plus } from 'lucide-preact';
import { ProjectSelectorDropdown, type ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';

export interface SettingsSidebarItem {
  id: string;
  name: string;
  description: string;
  scope: string;
  isBuiltIn?: boolean;
}

interface SettingsSidebarListProps {
  items: SettingsSidebarItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddNew: () => void;
  addTitle: string;
  builtInLabel: string;
  customLabel: string;
  formatName: (name: string) => string;
  nameClassName: string;
  renderIcon: (isBuiltIn: boolean) => ComponentChildren;
  selectedProject: string;
  onChangeProject: (project: string) => void;
  /** Real workspace folders; defaults to the shared placeholder list. */
  projectOptions?: ProjectOption[];
}

/**
 * Shared sidebar for the agent and command settings screens. The two differ
 * only by icon, name formatting, and section labels, all injected here.
 */
export const SettingsSidebarList: FunctionComponent<SettingsSidebarListProps> = ({
  items,
  selectedId,
  onSelect,
  onAddNew,
  addTitle,
  builtInLabel,
  customLabel,
  formatName,
  nameClassName,
  renderIcon,
  selectedProject,
  onChangeProject,
  projectOptions,
}) => {
  const builtInItems = items.filter((item) => item.isBuiltIn);
  const customItems = items.filter((item) => !item.isBuiltIn);

  const renderItem = (item: SettingsSidebarItem) => {
    const isSelected = item.id === selectedId;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => onSelect(item.id)}
        className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors cursor-pointer flex flex-col gap-0.5 group ${
          isSelected
            ? 'bg-ink/10 text-ink font-medium shadow-2xs'
            : 'text-ink/80 hover:bg-ink/5 hover:text-ink'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {renderIcon(Boolean(item.isBuiltIn))}
            <span className={nameClassName}>{formatName(item.name)}</span>
          </div>
          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-ink/10 text-ink/70 font-medium">
            {item.scope}
          </span>
        </div>
        <p className="text-[11px] text-ink/60 line-clamp-1 leading-snug pl-5">
          {item.description}
        </p>
      </button>
    );
  };

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0 select-none">
      <ProjectSelectorDropdown
        selectedProject={selectedProject}
        onChangeProject={onChangeProject}
        {...(projectOptions ? { options: projectOptions } : {})}
      />

      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          Total {items.length}
        </span>
        <button
          type="button"
          onClick={onAddNew}
          title={addTitle}
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-3 text-xs">
        <div>
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-ink/50 uppercase tracking-wider">
            {builtInLabel}
          </div>
          <div className="space-y-0.5">
            {builtInItems.map(renderItem)}
          </div>
        </div>

        <div>
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-bold text-ink/50 uppercase tracking-wider flex items-center justify-between">
            <span>{customLabel}</span>
            <span className="text-[10px] font-normal">{customItems.length}</span>
          </div>
          <div className="space-y-0.5">
            {customItems.map(renderItem)}
          </div>
        </div>
      </div>
    </div>
  );
};
