import { Trash2 } from 'lucide-preact';
import type { ProjectConfigItem } from '@/shared/types';

interface ProjectDetailsHeaderProps {
  project: ProjectConfigItem;
  canDelete: boolean;
  isDeleting?: boolean;
  onDelete: () => void;
}

/**
 * The detail pane's title block.
 *
 * The path used to live here as read-only text; it is an EDITABLE field now
 * (`PathField`), because a project bound to the wrong directory had to be
 * deleted and re-created to fix it. What stays here is identity plus the one
 * destructive action, named in full so it cannot be mistaken for "close".
 */
export function ProjectDetailsHeader({
  project,
  canDelete,
  isDeleting = false,
  onDelete,
}: ProjectDetailsHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 pb-4 border-b border-ink/10">
      <div className="min-w-0 flex-1">
        <h2 className="text-xl font-bold tracking-tight text-ink truncate">{project.name}</h2>
        <p className="text-[11px] font-mono text-ink/50 truncate mt-0.5 select-all">
          {project.path || 'Not bound to a directory'}
        </p>
      </div>

      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          disabled={isDeleting}
          title="Delete this project"
          className="inline-flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 text-[11px] font-medium text-ink/50 hover:text-error hover:bg-error/10 rounded-md transition-colors cursor-pointer disabled:opacity-50"
        >
          <Trash2 size={13} />
          <span>Delete</span>
        </button>
      )}
    </div>
  );
}
