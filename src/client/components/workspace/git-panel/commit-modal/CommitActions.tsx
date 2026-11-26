import type { GitCommit } from '@kabmo-labs/kabmo-app-contracts/git';

interface CommitActionsProps {
  commit: GitCommit;
  onAction: (action: string, commit: GitCommit) => void;
}

const ACTION_BUTTON_CLASS =
  'px-2.5 py-1 text-[11px] font-mono rounded border border-ink/20 hover:bg-ink/5 text-ink/80 hover:text-ink transition-colors cursor-pointer';

/** The row's git verbs, in the order the panel has always offered them. */
const ACTIONS: ReadonlyArray<{ action: string; label: string }> = [
  { action: 'checkout', label: 'checkout' },
  { action: 'create_branch_here', label: 'create branch here' },
  { action: 'cherry_pick', label: 'cherry-pick' },
  { action: 'revert', label: 'revert' },
  { action: 'reset', label: 'reset...' },
  { action: 'merge', label: 'merge into current' },
  { action: 'rebase', label: 'rebase onto this' },
];

export function CommitActions({ commit, onAction }: CommitActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 pb-2">
      {ACTIONS.map(({ action, label }) => (
        <button
          key={action}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAction(action, commit);
          }}
          className={ACTION_BUTTON_CLASS}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
