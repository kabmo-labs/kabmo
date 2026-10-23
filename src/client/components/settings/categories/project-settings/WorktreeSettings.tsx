/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Settings → Projects → Worktrees: the list, and the two settings that decide
 * where a new one lands.
 *
 * A row carries what the reader actually asks of a list of worktrees: which
 * branch is held there (and therefore cannot be checked out anywhere else), how
 * many chats start in it, and whether it is dirty. `missing` is its own line
 * because a worktree whose folder was deleted outside Kabmo still owns its
 * sessions, and hiding it would hide them.
 *
 * The two fields below the list are the settings a create reads on the server
 * (`worktreeDirectory`, `worktreeCarryIgnored`), so what is typed here is what
 * the next create uses — including one started by a scheduled task.
 */

import { useState } from 'preact/hooks';
import { readKabmoSetting, writeSetting } from '@/shared/lib/settings/client';
import { useWorktrees } from '@/client/hooks/workspace/worktree/index';
import { removeWorktree } from '@/client/hooks/workspace/worktree/index';
import { WORKTREE_CARRY_SETTING, WORKTREE_DIRECTORY_SETTING } from '@/shared/lib/fs/worktree/settings-keys';
import { branchDeletable, removalRefusal, worktreeRowDetail } from '@/client/components/settings/categories/project-settings/worktree-row';

export interface WorktreeSettingsProps {
  /** The selected project's `project_path`; the section is inert without one. */
  root: string | null;
  folderId: number | null;
  /** Report a refusal — the section never claims a removal it did not get. */
  onReport: (message: string, tone?: 'success' | 'error') => void;
}

export function WorktreeSettings({ root, folderId, onReport }: WorktreeSettingsProps) {
  const { worktrees, base, loading, error, refresh } = useWorktrees({ root, folderId }, Boolean(root));
  const [directory, setDirectory] = useState(() => {
    const stored = readKabmoSetting<string>(WORKTREE_DIRECTORY_SETTING);
    return typeof stored === 'string' ? stored : '';
  });
  const [carry, setCarry] = useState(() => readKabmoSetting<boolean>(WORKTREE_CARRY_SETTING) !== false);
  // `detached` rows name a commit instead of a branch, and the payload carries it.

  const [removing, setRemoving] = useState<string | null>(null);

  if (!root) {
    return <p className="text-xs text-ink/50">Bind this workspace to a repository to manage its worktrees.</p>;
  }

  const removable = worktrees.filter((worktree) => !worktree.isPrimary);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-ink">Worktrees</h3>
        {loading && <p className="text-[11px] text-ink/50">Reading worktrees…</p>}
        {error && (
          // A failed read is REPORTED, never rendered as "none": the two look
          // identical on screen and only one of them is actionable.
          <p className="text-[11px] text-error" title={error}>
            Worktrees could not be read: {error}
          </p>
        )}
        {!loading && !error && removable.length === 0 && (
          <p className="text-[11px] text-ink/50">No worktrees yet.</p>
        )}
        {removable.map((worktree) => (
          <div key={worktree.path} className="group flex items-center gap-2 rounded-md px-1 py-1.5 hover:bg-ink/5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-ink">{worktree.branch || 'detached'}</p>
              <p className="truncate text-[10.5px] text-ink/50" title={worktree.path}>
                {worktreeRowDetail(worktree)}
              </p>
            </div>
            <button
              type="button"
              disabled={removing === worktree.path || removalRefusal(worktree) !== null}
              aria-label={`Remove worktree ${worktree.branch || worktree.path}`}
              title={removalRefusal(worktree) ?? 'Remove worktree'}
              onClick={() => {
                setRemoving(worktree.path);
                void removeWorktree({ root, folderId }, worktree.path, { deleteBranch: branchDeletable(worktree) })
                  .then((result) => {
                    onReport(
                      result.branchDeleted
                        ? `Removed ${worktree.branch} and its branch`
                        : `Removed ${worktree.branch}${result.branchKept ? ' (branch kept)' : ''}`,
                      'success',
                    );
                    return refresh();
                  })
                  .catch((cause: unknown) => onReport(cause instanceof Error ? cause.message : String(cause), 'error'))
                  .finally(() => setRemoving(null));
              }}
              className="shrink-0 rounded px-2 py-1 text-[11px] text-ink/60 hover:bg-error/10 hover:text-error disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        ))}
      </section>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-ink">Worktree location</span>
        <input
          value={directory}
          onChange={(event) => setDirectory(event.currentTarget.value)}
          onBlur={() => writeSetting(WORKTREE_DIRECTORY_SETTING, directory.trim())}
          placeholder={base}
          className="h-8 rounded-md border border-ink/15 bg-paper px-2 text-xs text-ink outline-none focus:border-ink/40"
        />
        <span className="text-[10.5px] text-ink/50">
          Where new worktrees are created. Relative paths are resolved against the project; ~ is your home directory.
          Empty uses {base}.
        </span>
      </label>

      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          checked={carry}
          onChange={(event) => {
            const next = event.currentTarget.checked;
            setCarry(next);
            writeSetting(WORKTREE_CARRY_SETTING, next);
          }}
          className="mt-0.5"
        />
        <span className="flex flex-col gap-0.5">
          <span className="text-xs font-semibold text-ink">Copy ignored files into new worktrees</span>
          <span className="text-[10.5px] text-ink/50">
            A new worktree gets the project's ignored build folders (node_modules, .venv, target) copied in, so it works
            without reinstalling.
          </span>
        </span>
      </label>
    </div>
  );
}