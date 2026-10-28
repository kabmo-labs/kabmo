/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One wiki page: breadcrumbs, then the page rendered through the app's own
 * markdown pipeline.
 *
 * The renderer is the chat timeline's, in its `wikiScope` mode — so a page gets
 * the same sanitizing, syntax highlighting, KaTeX and mermaid hydration a
 * message gets, and its `[[Page]]` links expand and resolve into this wiki. That
 * sharing is the point: a wiki that documented a diagram in a ```mermaid fence
 * would otherwise show its source.
 */

import { useMemo } from 'preact/hooks';
import { AlertCircle, ArrowLeft, ExternalLink, Loader2 } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { WikiEntry, WikiPagePayload, WikiRepoInfo } from '@/shared/types/wiki';

interface WikiPageViewProps {
  repo: WikiRepoInfo;
  entries: readonly WikiEntry[];
  path: string;
  page: WikiPagePayload | null;
  isLoading: boolean;
  error: string | null;
  rootPath?: string;
  repoScope: string;
  onNavigate: (path: string) => void;
  onBack: () => void;
}

/** Web URL of one page, for "open on the host". Null for an unknown provider. */
function pageWebUrl(repo: WikiRepoInfo, path: string): string | null {
  if (!repo.webUrl) return null;
  const name = path.split('/').pop() ?? path;
  const title = name.replace(/\.(md|markdown)$/i, '');
  // GitHub's page URL takes the title; GitLab's takes the slug it stores.
  return repo.provider === 'gitlab'
    ? `${repo.webUrl.replace(/\/home$/, '')}/${encodeURIComponent(path.replace(/\.(md|markdown)$/i, ''))}`
    : `${repo.webUrl}/${encodeURIComponent(title)}`;
}

export function WikiPageView({
  repo,
  entries,
  path,
  page,
  isLoading,
  error,
  rootPath,
  repoScope,
  onNavigate,
  onBack,
}: WikiPageViewProps) {
  const externalUrl = pageWebUrl(repo, path);

  // Stable identity: a new object per render re-parses the whole page.
  const wikiScope = useMemo(
    () => ({ path, entries, root: rootPath, repo: repoScope }),
    [path, entries, rootPath, repoScope],
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-paper">
      <div className="flex flex-shrink-0 items-center gap-1.5 border-b border-ink/10 px-2.5 py-1.5">
        <button
          type="button"
          onClick={onBack}
          title="Back to the page list"
          aria-label="Back to the page list"
          className="flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink @[520px]:hidden"
        >
          <ArrowLeft size={13} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[11px] text-ink/50" title={path}>
          {path}
        </span>
        {isLoading && <Loader2 size={12} className="flex-shrink-0 animate-spin text-ink/40" />}
        {externalUrl && (
          <a
            href={externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this page on the wiki host"
            aria-label="Open this page on the wiki host"
            className="flex-shrink-0 rounded p-1 text-ink/60 hover:bg-ink/5 hover:text-ink"
          >
            <ExternalLink size={13} />
          </a>
        )}
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto scrollbar-overlay-container"
      >
        {error ? (
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <AlertCircle size={16} className="text-error" />
            <p className="text-xs text-error">{error}</p>
          </div>
        ) : !page ? (
          <div className="px-6 py-8 text-center text-xs text-ink/40">
            {isLoading ? 'Loading page…' : 'No page selected'}
          </div>
        ) : (
          <article className="mx-auto max-w-4xl px-5 py-4">
            <MarkdownRenderer
              content={page.content}
              className="max-w-none"
              wikiScope={wikiScope}
              onWikiNavigate={onNavigate}
            />
            {page.truncated && (
              <p className="mt-4 border-t border-ink/10 pt-2 text-[11px] text-ink/50">
                This page is longer than the reader's budget and was cut off.
              </p>
            )}
          </article>
        )}
      </div>
    </div>
  );
}
