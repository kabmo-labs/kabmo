/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The repo management modal, opened from the repo dropdown and from the git
 * panel's header.
 *
 * The dropdown could not host this: it is 208px wide with a 192px scroll area
 * and one `<button>` per repo, which stops working at the scale a workspace of
 * nested repositories reaches — measured on the author's install, one workspace
 * holds **144** repos. It also cannot carry per-repo state: a row there shows a
 * name and a checkmark, while what a reader needs from a list of working trees
 * is which ones are dirty, which have commits to push, and which are stopped on
 * a conflict.
 *
 * Follows the branch modal's shell (`max-w-[min(96vw,720px)]`, a filtered
 * scroll body), so this is a sibling of an existing surface rather than a new
 * convention.
 *
 * **Everything a row shows comes from ONE read per repo** (`?repoDetails=1`),
 * fetched when the modal opens and re-fetched when discovery reports it
 * finished. It is deliberately not on the status payload: that read is on the
 * realtime topic and republished on every tool call, and this one costs a `git`
 * spawn per repository.
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { FolderGit2, Loader2, RefreshCw, Search } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { RepoRow } from '@/client/components/workspace/repo-picker/Row';
import { useRepoDetails } from '@/client/hooks/workspace/repo-details';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { groupRepos, repoNameWithinGroup } from '@/shared/lib/fs/repo-groups';
import { repoLabel } from '@/shared/lib/fs/repo-label';
import { toAbsolutePath } from '@/shared/lib/fs/paths';

interface RepoModalProps {
  isOpen: boolean;
  rootPath?: string;
  /** The repo the panels are showing, so its row can be marked and disabled. */
  activeRepo: string;
  /** Discovered repos, from the shared store — the modal does not re-discover. */
  repos: readonly string[];
  /** Discovery is still running server-side. */
  scanning: boolean;
  onSelectRepo: (repo: string) => void;
  /** Force discovery to re-walk (the modal's Refresh). */
  onRefreshRepos: () => void;
  onClose: () => void;
}

export function RepoModal({
  isOpen,
  rootPath,
  activeRepo,
  repos,
  scanning,
  onSelectRepo,
  onRefreshRepos,
  onClose,
}: RepoModalProps) {
  const [query, setQuery] = useState('');
  // Copy and Reveal report INLINE rather than through a toast: three of the
  // five panels this picker serves (search, terminal, wiki) own no toast stack,
  // and a surface whose action silently does nothing on one layout and not
  // another is the bug the inline strip exists to prevent.
  const [notice, setNotice] = useState<{ text: string; kind: 'success' | 'error' } | null>(null);
  const { details, loading, reading, error, refresh } = useRepoDetails({ open: isOpen, rootPath, repos, scanning });

  // A closed modal keeps no filter or notice: reopening on another workspace
  // would otherwise show a list already narrowed by a query the user has
  // forgotten, over a message about an action they took elsewhere.
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setNotice(null);
    }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return details;
    return details.filter((row) => row.path.toLowerCase().includes(q));
  }, [details, query]);

  const groups = useMemo(() => groupRepos(filtered.map((row) => row.path)), [filtered]);
  const rowByPath = useMemo(() => {
    const map = new Map<string, (typeof details)[number]>();
    for (const row of details) map.set(row.path, row);
    return map;
  }, [details]);

  const refreshAll = useCallback(() => {
    // Both halves: the server walk (which may find repositories added since the
    // dialog opened) and the per-repo read (which is what the rows show).
    onRefreshRepos();
    refresh();
  }, [onRefreshRepos, refresh]);

  const copyPath = useCallback(
    async (repo: string) => {
      // Without a resolved root there is no absolute path to build; the
      // root-relative one is what the row actually knows, so that is what is
      // copied rather than an empty string.
      const absolute = rootPath ? toAbsolutePath(rootPath, repo === '.' ? '' : repo) : repo;
      const ok = await copyToClipboard(absolute);
      setNotice(ok ? { text: `Copied ${absolute}`, kind: 'success' } : { text: 'Clipboard unavailable', kind: 'error' });
    },
    [rootPath],
  );

  const reveal = useCallback(
    async (repo: string) => {
      const form = new FormData();
      form.append('actionType', 'open_explorer');
      form.append('path', '.');
      form.append('repo', repo);
      if (rootPath) form.append('root', rootPath);
      try {
        const response = await fetch('/api/fs/action', { method: 'POST', body: form });
        const body = (await response.json()) as { error?: string };
        if (!response.ok || body.error) {
          setNotice({ text: body.error || 'Could not open the file manager', kind: 'error' });
        }
      } catch {
        setNotice({ text: 'Could not open the file manager', kind: 'error' });
      }
    },
    [rootPath],
  );

  if (!isOpen) return null;

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-[min(96vw,720px)]"
      header={
        <div className="flex items-center gap-2 min-w-0">
          <FolderGit2 size={14} className="text-ink/60 flex-shrink-0" />
          <h2 className="text-sm font-semibold text-ink">Repositories</h2>
          <span className="text-[10px] font-mono text-ink/50 truncate">
            {repos.length} in this workspace
          </span>
        </div>
      }
    >
      <div className="px-5 py-3 flex items-center gap-2 border-b border-ink/10">
        <Search size={12} className="text-ink/40 flex-shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          placeholder="Filter repositories…"
          aria-label="Filter repositories"
          className="flex-1 min-w-0 bg-transparent outline-none text-xs text-ink placeholder-ink/40"
          autoFocus
        />
        <button
          type="button"
          onClick={refreshAll}
          disabled={reading || scanning}
          title="Re-discover repositories and re-read their state"
          aria-label="Refresh repositories"
          className="text-ink/40 hover:text-ink transition-colors cursor-pointer disabled:opacity-40 flex-shrink-0"
        >
          <RefreshCw size={12} className={reading || scanning ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* A discovery still running is NAMED. The rows are already true; the list
          is just not final yet, and a reader who closes the dialog believing it
          is complete would miss the repositories still being found. */}
      {scanning && (
        <div className="px-5 py-1.5 border-b border-ink/10 text-[10px] font-mono text-ink/50 flex items-center gap-1.5">
          <Loader2 size={10} className="animate-spin" />
          Still discovering repositories in this workspace…
        </div>
      )}

      {notice && (
        <div
          className={`px-5 py-1.5 border-b border-ink/10 text-[10px] font-mono truncate ${
            notice.kind === 'error' ? 'text-error' : 'text-ink/60'
          }`}
          title={notice.text}
          role="status"
        >
          {notice.text}
        </div>
      )}

      <div className="min-h-[40vh] max-h-[60vh] overflow-y-auto scrollbar-overlay-container">
        {loading && details.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink/50 font-mono">
            <Loader2 size={14} className="animate-spin text-info" />
            Reading repositories…
          </div>
        ) : error ? (
          <div className="py-12 px-6 text-center text-xs text-error font-mono">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-xs text-ink/40 font-mono">
            {query.trim() ? 'No matching repositories.' : 'No repositories in this workspace.'}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <div className="px-4 py-1 text-[9px] uppercase tracking-wider text-ink/40 font-semibold bg-canvas/40 border-b border-ink/5 sticky top-0">
                {group.label ?? repoLabel('.', rootPath)}
              </div>
              {group.paths.map((path) => {
                const row = rowByPath.get(path);
                if (!row) return null;
                return (
                  <RepoRow
                    key={path}
                    row={row}
                    active={path === activeRepo}
                    name={repoNameWithinGroup(path, group.key)}
                    loading={reading}
                    onSelect={() => {
                      onSelectRepo(path);
                      onClose();
                    }}
                    onCopyPath={() => void copyPath(path)}
                    onReveal={() => void reveal(path)}
                  />
                );
              })}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}
