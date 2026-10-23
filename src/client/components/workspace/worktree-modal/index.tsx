/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * New worktree — the dialog, modelled on OpenChamber's.
 *
 * Two columns on a wide screen and one on a phone, and the split is the point:
 * the left column is the CHOICE (which branch this checkout is), the right is the
 * NAMES (branch, base, folder). A single column put the choice above a wall of
 * fields and the "Create worktree" button below the fold.
 *
 * Three rules the form carries, each from a measured failure:
 *
 *  - **The folder follows the branch until the user edits it.** A dialog that
 *    asked for both independently produced a folder named after the previous
 *    branch the moment the branch was retyped; the reset button puts it back in
 *    sync and is disabled while it already is.
 *  - **Validation is the SERVER's.** A branch collision, a branch already checked
 *    out, an unborn repository — the client cannot know any of them without git,
 *    so the debounced call runs the same plan the create will run.
 *  - **The dirty notice states what stays behind.** Uncommitted changes are not
 *    carried into a new worktree, and a user told that afterwards has already
 *    lost the chance to commit them.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Modal } from '@/client/components/common/Modal';
import { createWorktree, validateWorktree } from '@/client/hooks/workspace/worktree/index';
import { WorktreeRequestError } from '@/client/hooks/workspace/worktree/index';
import { defaultWorktreeBranch, folderNameForBranch } from '@/shared/lib/workspace/worktree/branch-name';
import type { WorktreeFailure } from '@/shared/lib/workspace/worktree/types';

export interface NewWorktreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The project the worktree belongs to. */
  root: string | null;
  folderId: number | null;
  folderName?: string;
  /** Called with the created path — the caller selects it as the chat's target. */
  onCreated: (worktree: { path: string; branch: string }) => void;
}

type Mode = 'new' | 'existing';

/** A thrown request, narrowed to the failure the dialog reports. */
function asFailure(error: unknown): WorktreeFailure {
  if (error instanceof WorktreeRequestError) return error.failure;
  return { code: 'create_failed', message: error instanceof Error ? error.message : String(error) };
}

const FIELD_CLASS = 'w-full h-8 rounded-md border border-ink/15 bg-paper px-2 text-xs text-ink outline-none focus:border-ink/40';

export function NewWorktreeModal(props: NewWorktreeModalProps) {
  // Mounted fresh on every open, never reset by an effect. Preact runs effects
  // AFTER paint, so an effect-seeded form is on screen and focusable while its
  // fields still hold the previous open's values — and anything typed in that
  // window is discarded. Measured in the browser: the branch field was filled
  // with `main`, the effect then restored the generated name, and the dialog
  // created `wt/calm-iguana` instead of reporting that `main` is taken.
  if (!props.isOpen) return null;
  return <WorktreeForm {...props} />;
}

function WorktreeForm({ onClose, root, folderId, folderName, onCreated }: NewWorktreeModalProps) {
  const [mode, setMode] = useState<Mode>('new');
  // Seeded by the initial state, so the very first paint carries a usable form.
  const [branch, setBranch] = useState(defaultWorktreeBranch);
  const [basedOn, setBasedOn] = useState('');
  const [folder, setFolder] = useState(() => folderNameForBranch(branch));
  const [folderFollowsBranch, setFolderFollowsBranch] = useState(true);
  const [failure, setFailure] = useState<WorktreeFailure | null>(null);
  const [creating, setCreating] = useState(false);

  // The folder mirrors the branch while the user has not renamed it.
  useEffect(() => {
    if (!folderFollowsBranch) return;
    setFolder(folderNameForBranch(branch));
  }, [branch, folderFollowsBranch]);

  const request = useMemo(
    () => ({
      mode,
      branch: branch.trim(),
      worktreeName: folder.trim(),
      ...(basedOn.trim() ? { startRef: basedOn.trim() } : {}),
    }),
    [mode, branch, folder, basedOn],
  );

  // Debounced server validation, after the first edit — the answers depend on
  // git state a keystroke cannot know.
  useEffect(() => {
    if (!root) return;
    const timer = setTimeout(() => {
      void validateWorktree({ root, folderId }, request).then((result) => {
        setFailure(result.ok ? null : result.failures[0] ?? null);
      }).catch(() => {
        // A validation request that failed says nothing about the form; the
        // create reports what it finds.
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [root, folderId, request]);

  const canCreate = Boolean(root) && branch.trim().length > 0 && folder.trim().length > 0 && !creating && !failure;

  const submit = async () => {
    if (!root || !canCreate) return;
    setCreating(true);
    try {
      const created = await createWorktree({ root, folderId }, request);
      onCreated({ path: created.path, branch: created.branch });
      onClose();
    } catch (error) {
      // `WorktreeRequestError` carries the server's field/code; anything else is
      // reported as a create failure with its own message.
      setFailure(asFailure(error));
    } finally {
      setCreating(false);
    }
  };

  const choiceColumn = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold text-ink">Start from</span>
        {([
          { id: 'new' as const, label: 'New branch', hint: 'A fresh branch, based on the branch you pick.' },
          { id: 'existing' as const, label: 'Existing branch', hint: 'Check out a branch you already have.' },
        ]).map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            onClick={() => setMode(option.id)}
            className={`rounded-md border px-3 py-2 text-left transition-colors ${
              mode === option.id ? 'border-ink/40 bg-ink/5' : 'border-ink/15 hover:bg-ink/5'
            }`}
          >
            <span className="block text-xs font-medium text-ink">{option.label}</span>
            <span className="block text-[10.5px] text-ink/50">{option.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );

  const fieldColumn = (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-ink">{mode === 'existing' ? 'Branch' : 'Branch name'}</span>
        <input
          value={branch}
          onChange={(event) => setBranch(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder="feature/my-awesome-feature"
          className={FIELD_CLASS}
          aria-invalid={failure?.field === 'branch'}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-ink">Based on</span>
        <input
          value={basedOn}
          onChange={(event) => setBasedOn(event.currentTarget.value)}
          placeholder="origin/main"
          disabled={mode === 'existing'}
          className={`${FIELD_CLASS} disabled:opacity-50`}
        />
        <span className="text-[10px] text-ink/40">
          Defaults to the repository's default branch. Left empty means its current HEAD.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-ink">Folder name</span>
        <span className="flex items-center gap-1.5">
          <input
            value={folder}
            onChange={(event) => {
              setFolder(event.currentTarget.value);
              setFolderFollowsBranch(false);
            }}
            placeholder="my-worktree-directory"
            className={`${FIELD_CLASS} min-w-0 flex-1`}
            aria-invalid={failure?.field === 'folder'}
          />
          <button
            type="button"
            title="Reset to match branch name"
            aria-label="Reset to match branch name"
            disabled={folderFollowsBranch}
            onClick={() => {
              setFolderFollowsBranch(true);
              setFolder(folderNameForBranch(branch));
            }}
            className="h-8 shrink-0 rounded-md border border-ink/15 px-2 text-[11px] text-ink/70 hover:bg-ink/5 disabled:opacity-40"
          >
            ⟳
          </button>
        </span>
      </label>

      <p className="text-[10px] text-ink/45">
        Uncommitted changes stay in {folderName ? `“${folderName}”` : 'the project'}. A new worktree starts from a
        commit, so nothing half-written comes with it.
      </p>
    </div>
  );

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-[min(96vw,880px)]"
      header={<h2 className="text-sm font-semibold text-ink">New worktree</h2>}
      footer={
        <div className="flex w-full items-center gap-2 border-t border-ink/10 px-5 py-3">
          {/* One line that never grows the dialog; the full message is its title. */}
          <p
            className="min-w-0 flex-1 truncate text-[11px] text-error"
            title={failure?.message}
            role={failure ? 'alert' : undefined}
          >
            {failure?.message ?? ''}
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="h-8 shrink-0 rounded-md border border-ink/15 px-3 text-xs text-ink/80 hover:bg-ink/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canCreate}
            className="h-8 shrink-0 rounded-md bg-ink px-3 text-xs font-medium text-paper hover:bg-ink/90 disabled:opacity-40"
          >
            {creating ? 'Creating…' : 'Create worktree'}
          </button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-6 px-5 py-4 md:grid-cols-2">
        {choiceColumn}
        {fieldColumn}
      </div>
    </Modal>
  );
}