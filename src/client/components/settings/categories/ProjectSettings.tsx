import { useState } from 'preact/hooks';
import { ProjectSidebarList } from '@/client/components/settings/categories/project-settings/SidebarList';
import { ProjectDetailsForm } from '@/client/components/settings/categories/project-settings/DetailsForm';
import { AddProjectModal } from '@/client/components/settings/categories/project-settings/AddProjectModal';
import { DeleteProjectModal } from '@/client/components/settings/categories/project-settings/DeleteProjectModal';
import { WorktreeSettings } from '@/client/components/settings/categories/project-settings/WorktreeSettings';
import { LoadingState } from '@/client/components/settings/LoadingState';
import { SettingsMasterDetail } from '@/client/components/settings/master-detail';
import { useSettingsMasterDetail } from '@/client/hooks/settings/master-detail';
import { useSidebarData } from '@/client/hooks/chat/omp/session-list';
import { useProjectSettings } from '@/client/hooks/settings/projects';
import { useToasts } from '@/client/hooks/ui/toasts';
import type { ProjectConfigItem } from '@/shared/types';

/**
 * Settings → Projects.
 *
 * One pane owns every project fact: identity (name, directory, icon, accent),
 * the default model a chat born here starts on, pinning, worktrees, and the
 * destructive delete. Each is a real write with a real failure path — the pane
 * reports what the server refused and puts the row back, instead of showing a
 * value the server never accepted.
 */
export function ProjectSettings() {
  const masterDetail = useSettingsMasterDetail();
  const { pushToast } = useToasts();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectConfigItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);

  const state = useProjectSettings((message) => pushToast(message, 'error', { duration: 7000 }));
  const { folders } = useSidebarData();

  const reveal = async (project: ProjectConfigItem) => {
    if (!project.path || project.folderId === undefined) {
      pushToast('This project is not bound to a directory.', 'error');
      return;
    }
    setRevealingId(project.id);
    try {
      const response = await fetch(`/api/folders/${project.folderId}/open`, { method: 'POST' });
      const data: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const reason = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
          ? data.error
          : `HTTP ${response.status}`;
        throw new Error(reason);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setRevealingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      await state.deleteProject(deleteTarget);
      setDeleteTarget(null);
      masterDetail.back();
    } catch (error) {
      // The dialog stays up with the server's reason: closing it would leave a
      // row the user believes they removed sitting in the list.
      setDeleteError(error instanceof Error ? error.message : String(error));
    }
  };

  if (state.isLoading) {
    return <LoadingState>Loading projects…</LoadingState>;
  }

  const selected = state.selected;

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-paper text-ink">
      <SettingsMasterDetail
        pane={masterDetail.pane}
        onBack={masterDetail.back}
        listLabel="Projects"
        list={
          <ProjectSidebarList
            projects={state.projects}
            selectedProjectId={selected?.id ?? ''}
            onSelectProject={(id) => {
              state.select(id);
              masterDetail.openDetail();
            }}
            onAddProject={() => setIsAddOpen(true)}
            onTogglePin={(project) => {
              void state.updateField(project, 'isPinned', !project.isPinned);
            }}
            isAdding={state.isAdding}
            folderFacts={folders}
            loadError={state.loadError}
          />
        }
        detail={
          selected ? (
            <div className="flex-1 min-h-0 scrollbar-overlay-container flex flex-col">
              <ProjectDetailsForm
                project={selected}
                canDelete={state.projects.length > 1}
                isDeleting={state.isDeleting && deleteTarget?.id === selected.id}
                isRevealing={revealingId === selected.id}
                models={state.models}
                accentColorOptions={state.accentColorOptions}
                onUpdateField={(field, value) => {
                  void state.updateField(selected, field, value);
                }}
                onUpdateFields={(fields) => {
                  void state.updateFields(selected, fields);
                }}
                onReveal={() => void reveal(selected)}
                onDeleteProject={() => {
                  setDeleteError(null);
                  setDeleteTarget(selected);
                }}
              />
              {/* Worktrees belong to the PROJECT, not to a session: a create here
                  has no chat, and the next chat picks it from the composer. */}
              <div className="border-t border-ink/10 px-6 md:px-8 py-4">
                <WorktreeSettings
                  root={selected.path || null}
                  folderId={selected.folderId ?? null}
                  onReport={(message, tone) => pushToast(message, tone ?? 'success', { duration: 6000 })}
                />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center px-6 text-center">
              <div className="space-y-2">
                <p className="text-xs text-ink/60">No project selected.</p>
                <button
                  type="button"
                  onClick={() => setIsAddOpen(true)}
                  className="text-[11px] font-medium text-ink underline underline-offset-2 hover:no-underline cursor-pointer"
                >
                  Add a project
                </button>
              </div>
            </div>
          )
        }
      />

      <AddProjectModal
        isOpen={isAddOpen}
        isSaving={state.isAdding}
        onClose={() => setIsAddOpen(false)}
        onSubmit={async (input) => {
          await state.addProject(input);
          masterDetail.openDetail();
        }}
      />

      <DeleteProjectModal
        project={deleteTarget}
        isDeleting={state.isDeleting}
        error={deleteError}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={() => void confirmDelete()}
      />

    </div>
  );
}
