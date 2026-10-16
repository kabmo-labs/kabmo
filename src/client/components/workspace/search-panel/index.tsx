import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useFetcher } from '@/client/lib/router/fetcher';
import { SearchPanelBody } from '@/client/components/workspace/search-panel/Body';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import { useRepoList, useRepoScope } from '@/client/hooks/workspace/repo-scope';
import { useSearchStream } from '@/client/hooks/workspace/search-stream';
import { useOnClickOutside } from '@/client/hooks/ui/on-click-outside';

export function SearchPanel({ className = '', enabled = true, rootPath, onOpenFile }: { className?: string, enabled?: boolean, rootPath?: string, onOpenFile?: (file: unknown) => void }) {
  const [query, setQuery] = useSessionState<string>('search.query', '');
  const [replaceQuery, setReplaceQuery] = useSessionState<string>('search.replaceQuery', '');

  const [matchCase, setMatchCase] = useSessionState<boolean>('search.matchCase', false);
  const [wholeWord, setWholeWord] = useSessionState<boolean>('search.wholeWord', false);
  const [useRegex, setUseRegex] = useSessionState<boolean>('search.useRegex', false);

  const [includeFiles, setIncludeFiles] = useSessionState<string>('search.includeFiles', '');
  const [showMenu, setShowMenu] = useState(false);
  const [showIncludeField, setShowIncludeField] = useSessionState<boolean>('search.showIncludeField', false);
  const { activeRepo, setActiveRepo } = useRepoScope(rootPath);
  const { repos, scanning: reposScanning, rescan: rescanRepos } = useRepoList(rootPath, enabled);

  const menuRef = useRef<HTMLDivElement>(null);

  const replaceFetcher = useFetcher<{ success: boolean, results: { file: string; status: string }[] }>();

  // The tree being searched: the workspace root plus the selected repo. Every
  // result is relative to it, so a switch must not keep the previous tree's
  // hits on screen — `useSearchStream` tags them with this scope.
  const { results, isSearching, truncated, error, start: startSearch } = useSearchStream(`${rootPath ?? ''}\u0000${activeRepo}`);

  useOnClickOutside(menuRef, () => setShowMenu(false));

  const triggerSearch = useCallback(() => {
    if (!enabled) return;
    if (query.trim().length > 2) {
      return startSearch({
        q: query,
        matchCase: String(matchCase),
        wholeWord: String(wholeWord),
        useRegex: String(useRegex),
        includeFiles: showIncludeField ? includeFiles : '',
        ...(rootPath ? { root: rootPath } : {}),
        ...(activeRepo !== '.' ? { repo: activeRepo } : {})
      });
    }
  }, [enabled, query, matchCase, wholeWord, useRegex, showIncludeField, includeFiles, rootPath, activeRepo, startSearch]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      triggerSearch();
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [triggerSearch]);

  const handleReplace = useCallback((file?: string) => {
    if (!query) return;

    // If no file specified, replace all currently found files
    const targetFiles = file ? [file] : Array.from(new Set(results.map((result) => result.file)));

    if (targetFiles.length === 0) return;

    replaceFetcher.submit(
      {
        q: query,
        replaceWith: replaceQuery,
        matchCase: String(matchCase),
        wholeWord: String(wholeWord),
        useRegex: String(useRegex),
        files: JSON.stringify(targetFiles),
        ...(rootPath ? { root: rootPath } : {}),
        ...(activeRepo !== '.' ? { repo: activeRepo } : {})
      },
      { method: 'POST', action: '/api/fs/replace' }
    );
  }, [query, replaceQuery, matchCase, wholeWord, useRegex, results, rootPath, activeRepo, replaceFetcher]);

  // Trigger search again after replace completes
  useEffect(() => {
    if (replaceFetcher.state === 'idle' && replaceFetcher.data?.success) {
      triggerSearch();
    }
  }, [replaceFetcher.state, replaceFetcher.data, triggerSearch]);

  // NOTE: keep this early return below every hook — the desktop layout keeps
  // the panel mounted (hidden) while another view is active, and a hook count
  // that changes with `enabled` would crash React's hook dispatcher.
  if (!enabled) {
    return (
      <div className={`flex flex-col h-full bg-paper items-center justify-center text-ink/40 ${className}`}>
        <span className="text-xs font-mono">No session selected</span>
      </div>
    );
  }

  return (
    <SearchPanelBody
      className={className}
      query={query}
      setQuery={setQuery}
      replaceQuery={replaceQuery}
      setReplaceQuery={setReplaceQuery}
      matchCase={matchCase}
      setMatchCase={setMatchCase}
      wholeWord={wholeWord}
      setWholeWord={setWholeWord}
      useRegex={useRegex}
      setUseRegex={setUseRegex}
      includeFiles={includeFiles}
      setIncludeFiles={setIncludeFiles}
      showIncludeField={showIncludeField}
      setShowIncludeField={setShowIncludeField}
      showMenu={showMenu}
      setShowMenu={setShowMenu}
      menuRef={menuRef}
      rootPath={rootPath}
      activeRepo={activeRepo}
      setActiveRepo={setActiveRepo}
      repos={repos}
      reposScanning={reposScanning}
      rescanRepos={rescanRepos}
      results={results}
      isSearching={isSearching}
      truncated={truncated}
      error={error}
      onOpenFile={onOpenFile}
      handleReplace={handleReplace}
      replaceBusy={replaceFetcher.state !== 'idle'}
    />
  );
}
