/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The repo picker the right-panel views render.
 *
 * A THIN WRAPPER over the kit's `RepoPicker`, and deliberately so: a plugin
 * panel's header and this one describe the same working tree, and the kit
 * already ships the control — a second implementation here is how the label, the
 * filter and the checkmark drift between a plugin's picker and the host's. The
 * kit's component is the one place that draws it; this file only supplies what
 * is HOST-specific.
 *
 * Two host-only pieces remain, and they are why this wrapper exists at all:
 *
 * - **The modal.** A workspace with dozens of repositories cannot be managed
 *   from a 208px dropdown, so the list's footer opens a larger surface with
 *   grouping and per-repo state. The kit takes that as an optional `onManage`
 *   row, so a plugin — which has no such surface — draws no row and promises
 *   nothing.
 * - **The scope handle.** The host's panels own their own `useRepoScope` and
 *   pass the parts down (this component stays presentational so a test can drive
 *   it without a session), so the handle is assembled here from the props the
 *   panel already holds.
 */

import { useCallback, useMemo, useState } from 'preact/hooks';
import { RepoPicker } from '@kabmo-labs/kabmo-ui';
import { RepoModal } from '@/client/components/workspace/repo-picker/Modal';
import { repoLabel, repoShortLabel } from '@/shared/lib/fs/repo-label';

interface GitRepoPickerProps {
  rootPath?: string;
  activeRepo: string;
  onSelectRepo: (repo: string) => void;
  /** Discovered repos of the active root; the panel owns discovery. */
  repos: string[];
  /** Discovery or a forced rescan is in flight. */
  scanning: boolean;
  onRefreshRepos: () => void;
}

export function GitRepoPicker({
  rootPath,
  activeRepo,
  onSelectRepo,
  repos,
  scanning,
  onRefreshRepos,
}: GitRepoPickerProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // The rows carry their own labels, because the naming rule is the host's (see
  // `repo-label`): the root reads as its folder's name, a list row keeps its
  // whole root-relative path, and the trigger truncates to the last segment.
  const scope = useMemo(
    () => ({
      root: rootPath ?? null,
      repo: activeRepo,
      rows: repos.map((repo) => ({
        repo,
        label: repoLabel(repo, rootPath),
        short: repoShortLabel(repo, rootPath),
      })),
      scanning,
      ready: true,
      setRepo: onSelectRepo,
      refresh: onRefreshRepos,
    }),
    [rootPath, activeRepo, repos, scanning, onSelectRepo, onRefreshRepos],
  );

  const openModal = useCallback(() => setModalOpen(true), []);

  return (
    <div className="relative">
      <RepoPicker scope={scope} onManage={openModal} />
      <RepoModal
        isOpen={modalOpen}
        rootPath={rootPath}
        activeRepo={activeRepo}
        repos={repos}
        scanning={scanning}
        onSelectRepo={onSelectRepo}
        onRefreshRepos={onRefreshRepos}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
