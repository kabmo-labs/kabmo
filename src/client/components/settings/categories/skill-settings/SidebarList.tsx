import { useState } from 'preact/hooks';
import { ChevronDown, ChevronRight, Plus } from 'lucide-preact';
import type { SkillItem } from '@/shared/types';
import { ProjectSelectorDropdown, type ProjectOption } from '@/client/components/settings/ProjectSelectorDropdown';

interface SkillSidebarListProps {
  skills: SkillItem[];
  selectedSkillId: string | null;
  isCreatingNew: boolean;
  onSelectSkill: (id: string) => void;
  onAddNewSkill: () => void;
  selectedProject: string;
  onSelectProject: (project: string) => void;
  /** Real workspace folders; defaults to the shared placeholder list. */
  projectOptions?: ProjectOption[];
}

export function SkillSidebarList({
  skills,
  selectedSkillId,
  isCreatingNew,
  onSelectSkill,
  onAddNewSkill,
  selectedProject,
  onSelectProject,
  projectOptions,
}: SkillSidebarListProps) {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const toggleGroup = (groupName: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupName]: !prev[groupName],
    }));
  };

  // Group skills by group property or standalone
  const groupedSkills: Record<string, SkillItem[]> = {};
  const standaloneSkills: SkillItem[] = [];

  skills.forEach((skill) => {
    if (skill.group) {
      if (!groupedSkills[skill.group]) {
        groupedSkills[skill.group] = [];
      }
      groupedSkills[skill.group].push(skill);
    } else {
      standaloneSkills.push(skill);
    }
  });

  const totalCount = skills.length;

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      {/* Project Selector Dropdown */}
      <ProjectSelectorDropdown
        variant="compact"
        selectedProject={selectedProject}
        onChangeProject={onSelectProject}
        {...(projectOptions ? { options: projectOptions } : {})}
        getTriggerLabel={(options, value) =>
          options.find((option) => option.id === value || option.value === value)?.label || value
        }
      />

      {/* Counter Header */}
      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          Total {totalCount}
        </span>
        <button
          type="button"
          onClick={onAddNewSkill}
          title="Create New Skill"
          className="p-1 rounded-md text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      {/* Skills List */}
      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-2">
        {/* The picker above names the scope; the list is exactly that scope's
            skills, so a second scope claim here would only be able to lie. */}
        <div className="px-2 pt-1 pb-0.5 text-[10px] font-bold text-ink/50 uppercase tracking-wider">
          SKILLS
        </div>

        {/* Temporary "New Skill" indicator item */}
        {isCreatingNew && (
          <div className="px-2.5 py-1.5 rounded-lg bg-ink/10 text-ink font-medium text-xs shadow-2xs">
            <span className="truncate">new-skill</span>
          </div>
        )}

        {/* Grouped Skills */}
        {Object.entries(groupedSkills).map(([groupName, groupItems]) => {
          const isCollapsed = !!collapsedGroups[groupName];
          return (
            <div key={groupName} className="space-y-0.5">
              <button
                type="button"
                onClick={() => toggleGroup(groupName)}
                className="w-full flex items-center justify-between px-2 py-1 rounded-md text-xs font-semibold text-ink/80 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5 truncate">
                  {isCollapsed ? (
                    <ChevronRight size={13} className="text-ink/60" />
                  ) : (
                    <ChevronDown size={13} className="text-ink/60" />
                  )}
                  <span className="truncate tracking-tight uppercase text-[11px] font-bold text-ink/90">
                    {groupName}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-ink/50 px-1.5 py-0.2 rounded bg-ink/5">
                  {groupItems.length}
                </span>
              </button>

              {!isCollapsed && (
                <div className="pl-3 space-y-0.5 border-l border-ink/10 ml-2.5">
                  {groupItems.map((skill) => {
                    const isSelected = !isCreatingNew && selectedSkillId === skill.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => onSelectSkill(skill.id)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate block ${
                          isSelected
                            ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                            : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
                        }`}
                      >
                        {skill.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Standalone Skills */}
        <div className="space-y-0.5 pt-1">
          {standaloneSkills.map((skill) => {
            const isSelected = !isCreatingNew && selectedSkillId === skill.id;
            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => onSelectSkill(skill.id)}
                className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate block ${
                  isSelected
                    ? 'bg-ink/10 text-ink font-medium shadow-2xs'
                    : 'text-ink/70 hover:bg-ink/5 hover:text-ink'
                }`}
              >
                {skill.name}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
