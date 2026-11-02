import type { AccentColorOption, ProjectConfigItem } from '@/shared/types';
import type { ProjectModelChoice } from '@/client/hooks/settings/projects';
import { ProjectDetailsHeader } from '@/client/components/settings/categories/project-settings/DetailsHeader';
import { ProjectNameInput } from '@/client/components/settings/categories/project-settings/NameInput';
import { ProjectPathField } from '@/client/components/settings/categories/project-settings/PathField';
import { ProjectModelDropdown } from '@/client/components/settings/categories/project-settings/ModelDropdown';
import { ProjectAccentPalette } from '@/client/components/settings/categories/project-settings/AccentPalette';
import { ProjectIconGrid } from '@/client/components/settings/categories/project-settings/IconGrid';

interface ProjectDetailsFormProps {
  project: ProjectConfigItem;
  canDelete: boolean;
  isDeleting?: boolean;
  isRevealing?: boolean;
  models: ProjectModelChoice[];
  accentColorOptions?: AccentColorOption[];
  onUpdateField: <K extends keyof ProjectConfigItem>(field: K, value: ProjectConfigItem[K]) => void;
  /** A multi-field write (the icon's two halves go in one request). */
  onUpdateFields: (fields: Partial<ProjectConfigItem>) => void;
  onReveal: () => void;
  onDeleteProject: () => void;
}

/** The right-hand pane of Settings → Projects: identity, defaults, appearance.
 *  It does not own the scroll: the pane scrolls as one column so the worktree
 *  section below it is reachable instead of being clipped by a nested list. */
export function ProjectDetailsForm({
  project,
  canDelete,
  isDeleting = false,
  isRevealing = false,
  models,
  accentColorOptions,
  onUpdateField,
  onUpdateFields,
  onReveal,
  onDeleteProject,
}: ProjectDetailsFormProps) {
  return (
    <div className="p-6 md:p-8 space-y-7">
      <ProjectDetailsHeader
        project={project}
        canDelete={canDelete}
        isDeleting={isDeleting}
        onDelete={onDeleteProject}
      />

      <ProjectNameInput
        name={project.name}
        onCommit={(name) => onUpdateField('name', name)}
      />

      <ProjectPathField
        path={project.path}
        onCommit={(path) => onUpdateField('path', path)}
        onReveal={onReveal}
        isRevealing={isRevealing}
      />

      <ProjectModelDropdown
        model={project.model}
        models={models}
        onSelectModel={(value) => onUpdateField('model', value)}
      />

      <ProjectAccentPalette
        accentColor={project.accentColor}
        onSelectColor={(color) => onUpdateField('accentColor', color)}
        {...(accentColorOptions && accentColorOptions.length > 0 ? { options: accentColorOptions } : {})}
      />

      {/* The icon is TWO fields and one write: `icon` says which glyph, and
          `customIconUrl` carries the image. Sent as two PATCHes they race and the
          slower answer wins, which showed up as an uploaded icon that reverted. */}
      <ProjectIconGrid
        currentIcon={project.icon}
        customIconUrl={project.customIconUrl}
        projectName={project.name}
        onSelectIcon={(iconId) => onUpdateFields({ icon: iconId, customIconUrl: undefined })}
        onSetCustomIcon={(url) => onUpdateFields({
          customIconUrl: url,
          icon: url === undefined ? 'default' : 'custom',
        })}
      />
    </div>
  );
}
