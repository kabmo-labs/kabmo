import { useCallback, useMemo, useRef } from 'preact/hooks';
import { CaseSensitive, Check, MoreHorizontal, Regex, ReplaceAll, Search, WholeWord, X } from 'lucide-preact';
import type { RefObject } from 'preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import { SearchResults } from '@/client/components/workspace/search-panel/Results';
import { setSearchReveal } from '@/client/lib/search-reveal';
import { groupSearchResults, MAX_SEARCH_RESULTS } from '@/shared/lib/fs/search-list';
import type { SearchResultItem } from '@/shared/types/fs';
import type { FindOptions } from '@/shared/lib/code/editor/find-scan';

interface SearchPanelBodyProps {
  className: string;
  query: string;
  setQuery: (value: string) => void;
  replaceQuery: string;
  setReplaceQuery: (value: string) => void;
  matchCase: boolean;
  setMatchCase: (value: boolean) => void;
  wholeWord: boolean;
  setWholeWord: (value: boolean) => void;
  useRegex: boolean;
  setUseRegex: (value: boolean) => void;
  includeFiles: string;
  setIncludeFiles: (value: string) => void;
  showIncludeField: boolean;
  setShowIncludeField: (value: boolean) => void;
  showMenu: boolean;
  setShowMenu: (value: boolean) => void;
  menuRef: RefObject<HTMLDivElement>;
  rootPath?: string;
  activeRepo: string;
  setActiveRepo: (repo: string) => void;
  repos: string[];
  reposScanning: boolean;
  rescanRepos: () => void;
  results: readonly SearchResultItem[];
  isSearching: boolean;
  /** The server stopped the run at its cap; `results` is not the whole answer. */
  truncated: boolean;
  /** rg's own refusal — a regex it could not compile, or a pattern it read as a flag. */
  error: string | null;
  onOpenFile?: (file: unknown) => void;
  handleReplace: (file?: string) => void;
  replaceBusy: boolean;
}

/**
 * The search panel's markup, split from the state that drives it.
 *
 * The split exists for the result list: it holds tens of thousands of rows and
 * every keystroke in the replace field re-renders it, so the fields and the
 * list are kept in separate components — a keystroke here re-renders this tree
 * and leaves `SearchResults`' memoized rows alone.
 */
export function SearchPanelBody({
  className,
  query,
  setQuery,
  replaceQuery,
  setReplaceQuery,
  matchCase,
  setMatchCase,
  wholeWord,
  setWholeWord,
  useRegex,
  setUseRegex,
  includeFiles,
  setIncludeFiles,
  showIncludeField,
  setShowIncludeField,
  showMenu,
  setShowMenu,
  menuRef,
  rootPath,
  activeRepo,
  setActiveRepo,
  repos,
  reposScanning,
  rescanRepos,
  results,
  isSearching,
  truncated,
  error,
  onOpenFile,
  handleReplace,
  replaceBusy,
}: SearchPanelBodyProps) {
  const groups = useMemo(() => groupSearchResults(results), [results]);

  /**
   * The clear (×) buttons live INSIDE their field, and focus returns to it
   * after clearing: the point of the control is to retype the query, so a
   * cleared field the user has to click again is half the job. The buttons sit
   * in the field's own box rather than beside it for the same reason — a
   * control that clears the input belongs to the input.
   */
  const queryInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const clearQuery = useCallback(() => {
    setQuery('');
    queryInputRef.current?.focus();
  }, [setQuery]);
  const clearReplace = useCallback(() => {
    setReplaceQuery('');
    replaceInputRef.current?.focus();
  }, [setReplaceQuery]);

  // The same flags the search ran with, so the editor's own matcher paints the
  // identical set of occurrences once the file opens.
  const options: FindOptions = useMemo(() => ({ matchCase, wholeWord, isRegex: useRegex }), [matchCase, wholeWord, useRegex]);

  /**
   * A row click opens the file AND points the editor at the hit.
   *
   * The reveal request is published before the open, so the editor that finds
   * the file on screen already has it in hand — the tab entry cannot carry it,
   * because that entry is persisted and a reload would re-fire a served jump.
   *
   * Stable identity is what lets the memoized rows skip a re-render; the values
   * it reads are refs into the latest render, not props of the row.
   */
  const openResult = useCallback((result: SearchResultItem) => {
    setSearchReveal({ path: result.file, line: Number(result.line), query, options });
    onOpenFile?.({
      path: result.file,
      name: result.file.split('/').pop() || result.file,
      root: rootPath,
      repo: activeRepo,
    });
  }, [query, options, rootPath, activeRepo, onOpenFile]);

  const replaceFile = useCallback((file: string) => handleReplace(file), [handleReplace]);

  return (
    <div className={`flex flex-col h-full bg-paper ${className}`}>
      <div className="p-3 border-b border-ink/10 flex items-center justify-between">
        <div className="flex items-center space-x-2 min-w-0">
          <h2 className="text-xs font-semibold text-ink uppercase tracking-wider">Search</h2>
          <GitRepoPicker
            rootPath={rootPath}
            activeRepo={activeRepo}
            onSelectRepo={setActiveRepo}
            repos={repos}
            scanning={reposScanning}
            onRefreshRepos={rescanRepos}
          />
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowMenu(!showMenu)}
            className={`p-1 rounded hover:bg-ink/5 transition-colors ${showMenu || showIncludeField ? 'text-ink' : 'text-ink/40'}`}
            title="Search Options"
          >
            <MoreHorizontal size={14} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-48 bg-paper border border-ink/10 rounded shadow-lg z-10 py-1">
              <button
                onClick={() => {
                  setShowIncludeField(!showIncludeField);
                  if (showIncludeField) setIncludeFiles('');
                  setShowMenu(false);
                }}
                className="w-full px-3 py-1.5 text-left text-xs text-ink hover:bg-ink/5 flex items-center justify-between"
              >
                <span>Files to include</span>
                {showIncludeField && <Check size={12} className="text-ink/60" />}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="p-3 flex flex-col gap-2.5 border-b border-ink/10">
        <div className="relative">
          <div className="flex items-center border border-ink/20 rounded bg-paper focus-within:border-ink/40 focus-within:ring-1 focus-within:ring-ink/10 transition-all">
            <Search size={14} className="ml-2 text-ink/40 flex-shrink-0" />
            <input
              ref={queryInputRef}
              type="text"
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              className="w-full bg-transparent border-none text-xs px-2 py-1.5 focus:outline-none text-ink placeholder-ink/30 min-w-0"
            />
            {query && (
              <button
                type="button"
                onClick={clearQuery}
                title="Clear search"
                aria-label="Clear search"
                className="p-1 mr-0.5 rounded text-ink/40 hover:text-ink hover:bg-ink/5 flex-shrink-0"
              >
                <X size={12} />
              </button>
            )}
            <div className="flex items-center space-x-0.5 pr-1 text-ink/40 flex-shrink-0">
              <button
                onClick={() => setMatchCase(!matchCase)}
                className={`p-1 rounded hover:text-ink ${matchCase ? 'bg-ink/10 text-ink' : 'hover:bg-ink/5'}`}
                title="Match Case"
              >
                <CaseSensitive size={14} />
              </button>
              <button
                onClick={() => setWholeWord(!wholeWord)}
                className={`p-1 rounded hover:text-ink ${wholeWord ? 'bg-ink/10 text-ink' : 'hover:bg-ink/5'}`}
                title="Match Whole Word"
              >
                <WholeWord size={14} />
              </button>
              <button
                onClick={() => setUseRegex(!useRegex)}
                className={`p-1 rounded hover:text-ink ${useRegex ? 'bg-ink/10 text-ink' : 'hover:bg-ink/5'}`}
                title="Use Regular Expression"
              >
                <Regex size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="relative flex items-center space-x-1">
          <div className="flex flex-1 min-w-0 items-center border border-ink/20 rounded bg-paper focus-within:border-ink/40 focus-within:ring-1 focus-within:ring-ink/10 transition-all">
            <input
              ref={replaceInputRef}
              type="text"
              placeholder="Replace"
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.currentTarget.value)}
              className="flex-1 min-w-0 bg-transparent border-none text-xs px-2 py-1.5 focus:outline-none text-ink placeholder-ink/30"
            />
            {replaceQuery && (
              <button
                type="button"
                onClick={clearReplace}
                title="Clear replace"
                aria-label="Clear replace"
                className="p-1 mr-0.5 rounded text-ink/40 hover:text-ink hover:bg-ink/5 flex-shrink-0"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <button
            onClick={() => handleReplace()}
            disabled={results.length === 0 || replaceBusy}
            className="p-1.5 rounded border border-ink/20 text-ink/60 hover:text-ink hover:bg-ink/5 disabled:opacity-50 disabled:cursor-not-allowed bg-paper"
            title="Replace All"
          >
            <ReplaceAll size={14} />
          </button>
        </div>

        {showIncludeField && (
          <div className="relative">
            <input
              type="text"
              value={includeFiles}
              onChange={(e) => setIncludeFiles(e.currentTarget.value)}
              placeholder="Files to include (e.g. *.js, src/*)"
              className="w-full bg-paper border border-ink/20 rounded text-xs px-2 py-1.5 focus:outline-none focus:border-ink/40 focus:ring-1 focus:ring-ink/10 transition-all text-ink placeholder-ink/40"
            />
          </div>
        )}
      </div>

      {error && results.length === 0 ? (
        // rg refused the query. Saying so is the whole point: this state used to
        // render as "No results found.", which reports a broken regex as an
        // empty workspace.
        <div className="flex-1 px-3 py-3" role="alert">
          <div className="rounded border border-error/30 bg-error/5 px-2.5 py-2">
            <div className="text-[11px] font-semibold text-error">Search failed</div>
            <div className="mt-1 whitespace-pre-wrap break-words font-mono text-[10.5px] text-ink/70">{error}</div>
            {useRegex && (
              <div className="mt-1 text-[10.5px] text-ink/50">
                Regex is on — escape metacharacters such as <code className="font-mono">( ) [ ] * ? +</code> or turn it off to search literally.
              </div>
            )}
          </div>
        </div>
      ) : isSearching && results.length === 0 ? (
        <div className="flex-1 text-ink/40 italic text-center py-4">Searching...</div>
      ) : query.trim().length <= 2 ? (
        <div className="flex-1 text-ink/40 italic text-center py-4">Type at least 3 characters to search.</div>
      ) : results.length === 0 ? (
        <div className="flex-1 text-ink/40 italic text-center py-4">No results found.</div>
      ) : (
        <>
          {error && (
            <div className="px-3 pt-2 text-[10.5px] text-error" role="alert">
              Search failed: <span className="font-mono">{error}</span>
            </div>
          )}
          {isSearching && <div className="px-3 pt-2 text-ink/40 italic">Searching…</div>}
          {truncated && (
            // The run stopped at the server's cap, so the list below is not the
            // whole answer. Saying so is what keeps "not found here" from being
            // read as "not in this workspace".
            <div className="px-3 pt-2 text-ink/50 italic">
              Showing the first {MAX_SEARCH_RESULTS} matches — refine the query to see the rest.
            </div>
          )}
          <SearchResults
            groups={groups}
            replacement={replaceQuery}
            showReplacePreview={replaceQuery.length > 0}
            onOpen={openResult}
            onReplaceFile={replaceFile}
            replaceBusy={replaceBusy}
          />
        </>
      )}
    </div>
  );
}
