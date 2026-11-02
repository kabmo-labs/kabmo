import type { LucideIcon } from 'lucide-preact';
import { Pin, PinOff, Plus } from 'lucide-preact';
import type { ProjectConfigItem, WorkspaceFolderData } from '@/shared/types';
import { getProjectIcon } from '@/shared/lib/workspace/project-icon';

/** The subset of a sidebar folder row this list borrows, when one exists. */
type FolderFacts = Pick<WorkspaceFolderData, 'id' | 'totalSessions'>;

interface ProjectSidebarListProps {
  projects: ProjectConfigItem[];
  selectedProjectId: string;
  onSelectProject: (id: string) => void;
  onAddProject: () => void;
  onTogglePin: (project: ProjectConfigItem) => void;
  isAdding?: boolean;
  /** Session counts by folder id, so a row says how much is in there. */
  folderFacts?: FolderFacts[];
  /** What the list is, when the read failed. */
  loadError?: string | null;
}

/**
 * The project list.
 *
 * A row carries the four things a reader chooses by: the project's mark, its
 * name, how many chats it holds, and whether it is pinned — the same order the
 * sidebar uses, so the two surfaces agree about what a project IS. Pinning is
 * offered here because it reorders the sidebar and that is a project setting;
 * hiding it behind the sidebar's own menu made it the one project fact this
 * pane could not set.
 */
export function ProjectSidebarList({
  projects,
  selectedProjectId,
  onSelectProject,
  onAddProject,
  onTogglePin,
  isAdding = false,
  folderFacts = [],
  loadError = null,
}: ProjectSidebarListProps) {
  const counts = new Map(folderFacts.map((folder) => [folder.id, folder.totalSessions]));

  return (
    <div className="w-full md:w-64 md:border-r border-ink/10 h-full flex flex-col bg-paper/50 flex-shrink-0">
      <div className="px-3.5 py-2.5 border-b border-ink/10 flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onAddProject}
          disabled={isAdding}
          aria-label="Add project"
          title="Add project"
          className="p-1 rounded text-ink/60 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50"
        >
          <Plus size={15} strokeWidth={2.2} />
        </button>
      </div>

      <div className="flex-1 scrollbar-overlay-container p-1.5 space-y-0.5">
        {loadError && (
          <p className="px-2 py-2 text-[11px] text-error" title={loadError}>
            Projects could not be read: {loadError}
          </p>
        )}

        {!loadError && projects.length === 0 && (
          <div className="px-2 py-3 space-y-1.5">
            <p className="text-[11.5px] text-ink/60">No projects yet.</p>
            <button
              type="button"
              onClick={onAddProject}
              className="text-[11px] font-medium text-ink underline underline-offset-2 hover:no-underline cursor-pointer"
            >
              Add the first one
            </button>
          </div>
        )}

        {projects.map((proj) => {
          const isSelected = proj.id === selectedProjectId;
          const IconComp: LucideIcon = getProjectIcon(proj.icon);
          const count = proj.folderId === undefined ? undefined : counts.get(proj.folderId);

          return (
            <div
              key={proj.id}
              className={`group flex items-center rounded-md transition-colors ${
                isSelected ? 'bg-ink/10 shadow-2xs' : 'hover:bg-ink/5'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectProject(proj.id)}
                aria-current={isSelected ? 'true' : undefined}
                className="flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-left cursor-pointer"
              >
                {proj.customIconUrl ? (
                  <img
                    src={proj.customIconUrl}
                    alt=""
                    className="w-3.5 h-3.5 rounded-xs object-contain flex-shrink-0"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <IconComp
                    size={14}
                    className="flex-shrink-0"
                    style={{ color: proj.accentColor || 'currentColor' }}
                  />
                )}
                <span className={`text-[11.5px] truncate flex-1 ${isSelected ? 'font-medium text-ink' : 'text-ink/80'}`}>
                  {proj.name}
                </span>
                {typeof count === 'number' && count > 0 && (
                  <span className="shrink-0 font-mono text-[10px] text-ink/40">{count}</span>
                )}
              </button>

              <button
                type="button"
                onClick={() => onTogglePin(proj)}
                aria-label={proj.isPinned ? `Unpin ${proj.name}` : `Pin ${proj.name}`}
                title={proj.isPinned ? 'Unpin (stop sorting first)' : 'Pin (sort first in the sidebar)'}
                className={`shrink-0 mr-1 p-1 rounded transition-colors cursor-pointer ${
                  proj.isPinned
                    ? 'text-ink/70 hover:text-ink hover:bg-ink/10'
                    : 'text-ink/30 hover:text-ink/70 hover:bg-ink/10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                }`}
              >
                {proj.isPinned ? <Pin size={12} /> : <PinOff size={12} />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
