import { GitBranch } from 'lucide-preact';

interface GitInitRepositoryProps {
  /** The repo-relative path the panel is scoped to (`.` for the workspace root). */
  repo: string;
  isBusy: boolean;
  onInit: () => void;
}

/**
 * The Source Control panel's state for a folder that is not a repository.
 *
 * The panel used to render its full chrome here — branch toolbar, commit box,
 * "No changes found." — over a directory where every one of those controls
 * answers `fatal: not a git repository`, so the panel looked functional and did
 * nothing. `readGitStatus` now reports `isRepo: false` for that case, and this
 * is what the panel draws instead: the one action that turns the folder into
 * something the rest of the panel can act on.
 *
 * The button is labelled by `aria-label`, not by its visible text: the wording
 * ("Initialize repository") and the title (`git init` in this folder) name the
 * same command, and an accessible name that follows the label would change with
 * copy edits.
 */
export function GitInitRepository({ repo, isBusy, onInit }: GitInitRepositoryProps) {
  const where = repo === '.' ? 'this folder' : repo;
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 px-6 text-center">
      <GitBranch size={26} className="text-ink/25" aria-hidden />
      <div className="font-mono space-y-1">
        <p className="text-xs text-ink/70">Not a Git repository</p>
        <p className="text-[11px] leading-4 text-ink/40">
          Initialize one in {where} to track changes, commit and manage branches.
        </p>
      </div>
      <button
        type="button"
        onClick={onInit}
        disabled={isBusy}
        aria-label="Initialize Git repository"
        title={`git init in ${where}`}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded bg-ink text-canvas hover:bg-ink/90 transition-colors cursor-pointer text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <GitBranch size={12} aria-hidden />
        Initialize repository
      </button>
    </div>
  );
}
