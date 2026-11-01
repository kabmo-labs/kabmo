import { ChevronDown, ChevronRight, EyeOff, Lock, Plus, Search } from 'lucide-preact';
import { useState } from 'preact/hooks';
import type { SkillItem } from '@/shared/types';
import { ProjectSelectorDropdown, type ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';
import {
  SKILL_FILTERS,
  filterCounts,
  filterSkills,
  scopeLabel,
  sourceBadge,
  type SkillFilter,
} from '@/client/components/settings/categories/skill-settings/row-meta';

interface SkillSidebarListProps {
  skills: SkillItem[];
  selectedSkillId: string | null;
  isCreatingNew: boolean;
  onSelectSkill: (id: string) => void;
  onAddNewSkill: () => void;
  onImportFromGit: () => void;
  onOpenCatalog: () => void;
  selectedProject: string;
  onSelectProject: (project: string) => void;
  /** Real workspace folders; defaults to the shared placeholder list. */
  projectOptions?: ProjectOption[];
}

/**
 * The skills list: one omp scope at a time, searched and filtered in place.
 *
 * The counts on the filter chips are computed over the WHOLE list, so a chip
 * never disappears when its own filter is active — that is what makes "4
 * managed" a fact about the scope rather than about what is currently visible.
 */
export function SkillSidebarList({
  skills,
  selectedSkillId,
  isCreatingNew,
  onSelectSkill,
  onAddNewSkill,
  onImportFromGit,
  onOpenCatalog,
  selectedProject,
  onSelectProject,
  projectOptions,
}: SkillSidebarListProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SkillFilter>('all');

  const visible = filterSkills(skills, query, filter);
  const counts = filterCounts(skills);

  const groupedSkills: Record<string, SkillItem[]> = {};
  const standaloneSkills: SkillItem[] = [];
  for (const skill of visible) {
    if (skill.group) (groupedSkills[skill.group] ??= []).push(skill);
    else standaloneSkills.push(skill);
  }

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupName]: !prev[groupName] }));
  };

  const renderRow = (skill: SkillItem) => {
    const isSelected = !isCreatingNew && selectedSkillId === skill.id;
    return (
      <button
        key={skill.id}
        type="button"
        onClick={() => onSelectSkill(skill.id)}
        className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
          isSelected ? 'bg-ink/10 text-ink shadow-2xs' : 'text-ink/75 hover:bg-ink/5 hover:text-ink'
        }`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-xs font-medium">{skill.name}</span>
          {skill.hidden ? <EyeOff size={11} className="text-ink/40 flex-shrink-0" title="Hidden from the model" /> : null}
          {skill.managed !== true ? <Lock size={10} className="text-ink/35 flex-shrink-0" title="Read-only" /> : null}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-ink/45 mt-0.5">
          <span className="font-mono px-1 rounded bg-ink/5 flex-shrink-0">{sourceBadge(skill)}</span>
          <span className="truncate">{scopeLabel(skill)}</span>
        </div>
      </button>
    );
  };

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      <ProjectSelectorDropdown
        variant="compact"
        selectedProject={selectedProject}
        onChangeProject={onSelectProject}
        {...(projectOptions ? { options: projectOptions } : {})}
        getTriggerLabel={(options, value) =>
          options.find((option) => option.id === value || option.value === value)?.label || value
        }
      />

      <div className="px-3 pt-2.5 pb-2 space-y-2 border-b border-ink/10">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1.5 text-ink/40 pointer-events-none" />
          <input
            type="text"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Filter skills…"
            className="w-full pl-7 pr-2 py-1 rounded-md border border-ink/20 bg-paper focus:outline-none focus:border-ink text-[11px] text-ink transition-colors"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {SKILL_FILTERS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setFilter(entry.id)}
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-colors cursor-pointer ${
                filter === entry.id ? 'bg-ink text-paper' : 'text-ink/60 hover:bg-ink/5 hover:text-ink'
              }`}
            >
              {entry.label} {counts[entry.id]}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onAddNewSkill}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-ink text-paper text-[11px] font-medium hover:bg-ink/90 transition-colors cursor-pointer"
        >
          <Plus size={13} />
          <span>New skill</span>
        </button>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-2">
        {isCreatingNew ? (
          <div className="px-2.5 py-1.5 rounded-lg bg-ink/10 text-ink font-medium text-xs">new-skill</div>
        ) : null}

        {visible.length === 0 ? (
          <div className="px-2.5 py-6 text-center space-y-1">
            <p className="text-[11px] text-ink/60">
              {skills.length === 0 ? 'No skills in this scope.' : 'Nothing matches that filter.'}
            </p>
            {skills.length === 0 ? (
              <p className="text-[10px] text-ink/45">
                Create one with <span className="font-semibold">New skill</span>, import a repository, or browse the
                catalog.
              </p>
            ) : null}
          </div>
        ) : null}

        {Object.entries(groupedSkills).map(([groupName, groupItems]) => {
          const isCollapsed = !!collapsedGroups[groupName];
          return (
            <div key={groupName} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(groupName)}
                className="w-full flex items-center justify-between px-2 py-1 rounded-md text-ink/80 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  {isCollapsed ? (
                    <ChevronRight size={13} className="text-ink/60" />
                  ) : (
                    <ChevronDown size={13} className="text-ink/60" />
                  )}
                  <span className="truncate text-[11px] font-bold uppercase tracking-tight text-ink/90">
                    {groupName}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-ink/50 px-1.5 rounded bg-ink/5">{groupItems.length}</span>
              </button>
              {!isCollapsed ? (
                <div className="pl-3 space-y-0.5 border-l border-ink/10 ml-2.5">{groupItems.map(renderRow)}</div>
              ) : null}
            </div>
          );
        })}

        {standaloneSkills.length > 0 ? (
          <div className="space-y-0.5 pt-1">{standaloneSkills.map(renderRow)}</div>
        ) : null}
      </div>

      <div className="p-2 border-t border-ink/10 space-y-1">
        <button
          type="button"
          onClick={onImportFromGit}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border border-ink/20 hover:border-ink/40 text-[11px] font-medium text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          Import from Git
        </button>
        <button
          type="button"
          onClick={onOpenCatalog}
          className="w-full px-2 py-1.5 rounded-lg text-[11px] font-medium text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          Browse the catalog
        </button>
      </div>
    </div>
  );
}
