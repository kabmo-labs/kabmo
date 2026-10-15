import type { AccentColorOption, ProjectConfigItem } from '@/shared/types';
import { ProjectDetailsHeader } from '@/client/components/settings/categories/project-settings/DetailsHeader';
import { ProjectNameInput } from '@/client/components/settings/categories/project-settings/NameInput';
import { ProjectModelDropdown } from '@/client/components/settings/categories/project-settings/ModelDropdown';
import { ProjectAccentPalette } from '@/client/components/settings/categories/project-settings/AccentPalette';
import { ProjectIconGrid } from '@/client/components/settings/categories/project-settings/IconGrid';

interface ProjectDetailsFormProps {
  project: ProjectConfigItem;
  canDelete: boolean;
  onUpdateField: <K extends keyof ProjectConfigItem>(field: K, value: ProjectConfigItem[K]) => void;
  onDeleteProject: () => void;
  availableModels?: string[];
  accentColorOptions?: AccentColorOption[];
}

export function ProjectDetailsForm({
  project,
  canDelete,
  onUpdateField,
  onDeleteProject,
  availableModels,
  accentColorOptions,
}: ProjectDetailsFormProps) {
  return (
    <div className="flex-1 scrollbar-overlay-container p-6 md:p-8 space-y-7">
      {/* 1. Header with title, full path, and delete button */}
      <ProjectDetailsHeader
        project={project}
        canDelete={canDelete}
        onDelete={onDeleteProject}
      />

      {/* 2. Project Name Input */}
      <ProjectNameInput
        name={project.name}
        onChangeName={(newName) => {
          onUpdateField('name', newName);
          // If the path ended with the old name, update it seamlessly
          if (project.path.endsWith(project.name)) {
            const basePath = project.path.slice(0, -project.name.length);
            onUpdateField('path', `${basePath}${newName}`);
          }
        }}
      />

      {/* 3. Defaults for new chats (Model selection) */}
      <ProjectModelDropdown
        model={project.model}
        onSelectModel={(newModel) => onUpdateField('model', newModel)}
        models={availableModels}
      />

      {/* 4. Accent Color Palette */}
      <ProjectAccentPalette
        accentColor={project.accentColor}
        onSelectColor={(newColor) => onUpdateField('accentColor', newColor)}
        options={accentColorOptions}
      />

      {/* 5. Project Icon Picker Grid + Upload/Favicon Actions */}
      <ProjectIconGrid
        currentIcon={project.icon}
        customIconUrl={project.customIconUrl}
        projectName={project.name}
        onSelectIcon={(iconId) => onUpdateField('icon', iconId)}
        onSetCustomIcon={(url) => onUpdateField('customIconUrl', url)}
      />
    </div>
  );
}
