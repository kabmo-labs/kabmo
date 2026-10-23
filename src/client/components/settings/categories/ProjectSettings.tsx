import { useEffect, useMemo, useState } from 'preact/hooks';
import type { AccentColorOption, ProjectConfigItem } from '@/shared/types';
import { ProjectSidebarList } from '@/client/components/settings/categories/project-settings/SidebarList';
import { ProjectDetailsForm } from '@/client/components/settings/categories/project-settings/DetailsForm';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { WorktreeSettings } from '@/client/components/settings/categories/project-settings/WorktreeSettings';
import { useToasts } from '@/client/hooks/ui/toasts';

export function ProjectSettings() {
  const masterDetail = useSettingsMasterDetail();
  const { pushToast } = useToasts();
  const [projects, setProjects] = useState<ProjectConfigItem[]>([]);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [accentColorOptions, setAccentColorOptions] = useState<AccentColorOption[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj-workspace');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const loadProjects = async () => {
      try {
        const response = await fetch('/api/settings/projects');
        const data = await response.json();
        if (!active) return;
        if (Array.isArray(data?.projects)) {
          setProjects(data.projects);
          setSelectedProjectId((current) =>
            data.projects.some((project: ProjectConfigItem) => project.id === current)
              ? current
              : data.projects[0]?.id || '',
          );
        }
        if (Array.isArray(data?.availableModels)) setAvailableModels(data.availableModels);
        if (Array.isArray(data?.accentColorOptions)) setAccentColorOptions(data.accentColorOptions);
      } catch (error) {
        console.error('Failed to load projects from API:', error);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadProjects();
    return () => { active = false; };
  }, []);

  const persistProjectField = async <K extends keyof ProjectConfigItem>(
    project: ProjectConfigItem,
    field: K,
    value: ProjectConfigItem[K],
  ) => {
    if (project.folderId === undefined) return;
    try {
      const response = await fetch('/api/settings/projects', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: {
            folderId: project.folderId,
            [field]: value === undefined ? null : value,
          },
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.error('Failed to save project settings:', error);
    }
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const handleAddProject = async () => {
    const newName = `Project ${projects.length + 1}`;
    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const data = await response.json();
      if (!response.ok || !data?.success) throw new Error(data?.error || `HTTP ${response.status}`);
      const folderId = data.folder?.id;
      if (typeof folderId !== 'number') throw new Error('Created workspace has no folder id');

      const newProject: ProjectConfigItem = {
        id: `folder-${folderId}`,
        folderId,
        name: data.folder.name,
        path: data.folder.project_path || '',
        model: 'Not selected',
        accentColor: '',
        icon: 'default',
        isPinned: false,
        isExpanded: true,
      };
      setProjects((current) => [...current, newProject]);
      setSelectedProjectId(newProject.id);
      // On a phone the new project's details are the point of adding it; the
      // list pane would hide the row that was just created.
      masterDetail.openDetail();
    } catch (error) {
      console.error('Failed to add project:', error);
    }
  };

  const handleDeleteProject = async () => {
    if (projects.length <= 1) return;
    const targetId = selectedProjectId;
    try {
      const response = await fetch(`/api/settings/projects?id=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const updated = projects.filter((project) => project.id !== targetId);
      setProjects(updated);
      setSelectedProjectId(updated[0]?.id || '');
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  };

  const handleUpdateField = <K extends keyof ProjectConfigItem>(
    field: K,
    value: ProjectConfigItem[K]
  ) => {
    if (!selectedProject) return;
    setProjects((current) => current.map((project) => (
      project.id === selectedProject.id ? { ...project, [field]: value } : project
    )));
    void persistProjectField(selectedProject, field, value);
  };

  // Folder rows ride the `sidebar` topic, so every writer (this pane, the
  // sidebar menu, another tab) reaches this list through one signal rather than
  // through a window event each caller had to remember to dispatch.
  const sidebarFolders = useSidebarData().folders;
  const refreshKey = useMemo(
    () => sidebarFolders.map((folder) => `${folder.id}:${folder.name}:${folder.model ?? ''}:${folder.icon ?? ''}:${folder.accentColor ?? ''}:${folder.isPinned ? 1 : 0}`).join('|'),
    [sidebarFolders],
  );
  useEffect(() => {
    if (!refreshKey) return;
    void fetch('/api/settings/projects')
      .then((response) => response.json())
      .then((data) => {
        if (Array.isArray(data?.projects)) {
          setProjects(data.projects);
          setSelectedProjectId((current) =>
            data.projects.some((project: ProjectConfigItem) => project.id === current)
              ? current
              : data.projects[0]?.id || '',
          );
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to refresh projects:', error);
      });
  }, [refreshKey]);

  if (isLoading) {
    return <LoadingState>Loading projects from database...</LoadingState>;
  }

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-paper text-ink">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Projects"
        list={
          <ProjectSidebarList
            projects={projects}
            selectedProjectId={selectedProject?.id || ''}
            onSelectProject={(id) => {
              setSelectedProjectId(id);
              masterDetail.openDetail();
            }}
            onAddProject={handleAddProject}
          />
        }
        detail={
          selectedProject ? (
            <div className="flex flex-col">
              <ProjectDetailsForm
                project={selectedProject}
                canDelete={projects.length > 1}
                onUpdateField={handleUpdateField}
                onDeleteProject={handleDeleteProject}
                availableModels={availableModels}
                accentColorOptions={accentColorOptions}
              />
              {/* Worktrees belong to the PROJECT, not to a session: a create here
                  has no chat, and the next chat picks it from the composer. */}
              <div className="border-t border-ink/10 px-4 py-4">
                <WorktreeSettings
                  root={selectedProject.path}
                  folderId={selectedProject.folderId ?? null}
                  onReport={(message, tone) => pushToast(message, tone ?? 'success', { duration: 6000 })}
                />
              </div>
            </div>
          ) : null
        }
      />
    </div>
  );
}
