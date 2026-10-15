/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Right-panel Wiki: the documentation of the repository the shared repo picker
 * points at.
 *
 * The repository is not chosen here — it is the SAME selection the Files,
 * Search, Git and Terminal views share (`useRepoScope`), so switching repos in
 * any of them moves this panel too, and the picker is rendered from the same
 * shared hook so this view can be the one that moves it.
 *
 * Where the pages come from: the project's `origin` remote with `.wiki.git` on
 * the end, read over git. That single fact is why one panel covers GitHub,
 * GitLab and a self-hosted GitLab with no provider setting — see
 * `@/server/lib/wiki/remote` and `@/server/lib/wiki/mirror.server`.
 */

import { useEffect, useMemo, useState } from 'preact/hooks';
import { AlertCircle, BookOpen, ExternalLink, Loader2, RefreshCw } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import { WikiNav } from '@/client/components/workspace/wiki-panel/Nav';
import { WikiPageView } from '@/client/components/workspace/wiki-panel/PageView';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useWikiPage, useWikiTree, wikiScopeKey } from '@/client/hooks/workspace/wiki';
import { sectionsFromEntries } from '@/shared/lib/wiki/sidebar';
import type { WikiUnavailableReason } from '@/shared/types/wiki';

interface WikiPanelProps {
  className?: string;
  enabled?: boolean;
  /** False while the panel is hidden (desktop right panel / mobile tab). */
  active?: boolean;
  rootPath?: string;
  refreshKey?: number;
}

/** Why there is no wiki, in the reader's terms. */
const REASON_TEXT: Record<WikiUnavailableReason, string> = {
  'no-remote': 'This repository has no origin remote, so there is no wiki to find.',
  'unsupported-remote': 'The origin remote is not a URL a wiki can be derived from.',
  'no-wiki': 'This project has no wiki (or the chamber cannot read it).',
  unreachable: 'The wiki could not be reached.',
};

/** The selection, kept next to the scope it was made in. */
interface WikiPick {
  scope: string;
  path: string;
}

export function WikiPanel({ className = '', enabled = true, active = true, rootPath, refreshKey = 0 }: WikiPanelProps) {
  const { activeRepo, setActiveRepo } = useRepoScope(rootPath);
  const { repos, scanning: reposScanning, rescan: rescanRepos } = useRepoList(rootPath, enabled);
  const scope = wikiScopeKey(rootPath, activeRepo);

  // The pick is stored WITH its scope: a page path from another repository names
  // a page this wiki does not have, and restoring it would open a 404.
  const [pick, setPick] = useSessionState<WikiPick | null>('wiki.selectedPage', null);
  const [narrowShowingPage, setNarrowShowingPage] = useState(false);
  // Bumped by the panel's own Refresh so the open page follows a re-listed tree
  // (the tree's revision is what a page read is anchored to).
  const [revision, setRevision] = useState(0);

  const tree = useWikiTree({ rootPath, repo: activeRepo, enabled, active, revisionKey: refreshKey });
  const entries = tree.data?.entries ?? [];
  const pages = useMemo(() => entries.filter((entry) => entry.isMarkdown), [entries]);
  // The wiki's own navigation when it has one; the folder-grouped fallback
  // otherwise, so a wiki with no `_Sidebar.md` is never un-navigable.
  const sections = useMemo(
    () => tree.data?.sidebar ?? sectionsFromEntries(entries),
    [tree.data?.sidebar, entries],
  );

  const storedPath = pick && pick.scope === scope ? pick.path : null;
  // The stored page when it still exists in this wiki, else Home, else the first
  // page — a wiki whose Home was renamed still opens on something readable.
  const selectedPath = useMemo(() => {
    if (storedPath && pages.some((page) => page.path === storedPath)) return storedPath;
    const home = pages.find((page) => page.title.toLowerCase() === 'home');
    return (home ?? pages[0])?.path ?? null;
  }, [storedPath, pages]);

  const page = useWikiPage({
    rootPath,
    repo: activeRepo,
    path: selectedPath,
    enabled,
    active,
    revisionKey: revision,
  });

  // Persist the resolved selection so a reload reopens the same page rather than
  // re-deriving it (and so the picker survives a wiki whose Home appears later).
  useEffect(() => {
    if (!selectedPath || selectedPath === storedPath) return;
    setPick({ scope, path: selectedPath });
  }, [selectedPath, storedPath, scope, setPick]);

  // A different wiki is a different document: drop the narrow-layout drill-down
  // so a repo switch lands on the list rather than on a page of the old one.
  useEffect(() => {
    setNarrowShowingPage(false);
  }, [scope]);

  const handleSelect = (path: string) => {
    setPick({ scope, path });
    setNarrowShowingPage(true);
  };

  const handleRefresh = () => {
    tree.reload({ force: true });
    setRevision((value) => value + 1);
  };

  const repo = tree.data?.repo ?? null;
  const unavailable = tree.data && !repo ? tree.data : null;

  // Same gate the other workspace-scoped views take: a wiki hangs off a
  // repository, so with no active workspace there is nothing to read — and the
  // panel must say so rather than sit on "Reading the wiki…" forever, since no
  // request is ever made.
  if (!enabled) {
    return (
      <div className={`flex h-full flex-col items-center justify-center bg-paper text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  return (
    <div className={`@container flex h-full min-h-0 w-full flex-col bg-paper text-xs text-ink ${className}`}>
      <div className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-ink/10 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <GitRepoPicker
            rootPath={rootPath}
            activeRepo={activeRepo}
            onSelectRepo={setActiveRepo}
            repos={repos}
            scanning={reposScanning}
            onRefreshRepos={rescanRepos}
          />
          {repo && (
            <span
              className="flex-shrink-0 rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wider text-ink/60"
              title={`${repo.host}/${repo.slug} · ${repo.revision.slice(0, 8)}`}
            >
              {repo.provider}
            </span>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-0.5">
          {repo?.webUrl && (
            <a
              href={repo.webUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the wiki on its host"
              aria-label="Open the wiki on its host"
              className="rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink"
            >
              <ExternalLink size={13} />
            </a>
          )}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={tree.isLoading}
            title="Re-fetch the wiki"
            aria-label="Re-fetch the wiki"
            className="rounded p-1 text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
          >
            <RefreshCw size={13} className={tree.isLoading || tree.refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {tree.error && !tree.data ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <AlertCircle size={16} className="text-error" />
          <p className="text-error">{tree.error}</p>
          <button type="button" onClick={() => tree.reload()} className="text-[11px] font-semibold text-ink/70 underline underline-offset-2 hover:text-ink">
            Try again
          </button>
        </div>
      ) : !tree.data ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-ink/40">
          <Loader2 size={14} className="animate-spin" />
          <span>Reading the wiki…</span>
        </div>
      ) : unavailable ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <BookOpen size={18} className="text-ink/30" />
          <p className="max-w-sm text-[11px] leading-relaxed text-ink/60">
            {REASON_TEXT[unavailable.reason ?? 'no-wiki']}
          </p>
          {unavailable.detail && (
            <p className="max-w-sm break-words font-mono text-[10px] text-ink/40">{unavailable.detail}</p>
          )}
        </div>
      ) : (
        // The nav is on the RIGHT (`flex-row-reverse`), so the page keeps the
        // panel's leading edge and the list reads as a menu beside it. The
        // reverse is visual only: the DOM order stays list → page, so the
        // narrow drill-down's hidden/shown pair needs no second set of rules.
        <div className="flex min-h-0 flex-1 flex-col @[520px]:flex-row-reverse">
          <div
            className={`min-h-0 w-full @[520px]:w-52 @[520px]:flex-shrink-0 border-b border-ink/10 @[520px]:border-b-0 @[520px]:border-l ${
              narrowShowingPage ? 'hidden @[520px]:flex' : 'flex'
            } flex-col`}
          >
            <WikiNav sections={sections} selected={selectedPath} onSelect={handleSelect} />
          </div>

          <div
            className={`min-w-0 min-h-0 flex-1 ${narrowShowingPage ? 'flex' : 'hidden @[520px]:flex'} flex-col`}
          >
            {repo && selectedPath ? (
              <WikiPageView
                repo={repo}
                entries={entries}
                path={selectedPath}
                page={page.data}
                isLoading={page.isLoading}
                error={page.error}
                rootPath={rootPath}
                repoScope={activeRepo}
                onNavigate={handleSelect}
                onBack={() => setNarrowShowingPage(false)}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-[11px] text-ink/40">
                This wiki has no markdown pages.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
