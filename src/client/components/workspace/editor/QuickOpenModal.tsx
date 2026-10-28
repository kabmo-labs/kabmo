/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Quick open (⌘P): a file picker over `/api/fs/list`.
 *
 * The index is fetched once per scope and cached for the session: the route walks
 * the tree, so re-reading it on every keystroke would be a walk per character. A
 * `workspace-dirty` signal invalidates it, because a file created by the agent (or
 * by the New File dialog) is exactly the file a picker should be able to find.
 *
 * ## The dialog is the same shell as Go-to-line, deliberately
 *
 * Two one-field modals that look different read as two different features; the
 * keyboard contract (type, arrows, Enter, Escape) is the only thing the user has to
 * learn, so both use it.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { Modal } from '@/client/components/common/Modal';
import { fetchQuickOpenIndex, rankQuickOpen, type QuickOpenEntry } from '@/client/hooks/editor/quick-open';

interface QuickOpenModalProps {
  root?: string | null;
  repo?: string | null;
  onOpen: (path: string) => void;
  onClose: () => void;
}

/** Index cache, keyed by scope. `bun --hot` keeps it, which is the point. */
const indexCache = new Map<string, QuickOpenEntry[]>();

/** Drop the cached index — a `workspace-dirty` signal means a file may be new. */
export function invalidateQuickOpenIndex(): void {
  indexCache.clear();
}

export function QuickOpenModal({ root, repo, onOpen, onClose }: QuickOpenModalProps) {
  const scope = `${root ?? ''}\u0000${repo ?? '.'}`;
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<QuickOpenEntry[]>(() => indexCache.get(scope) ?? []);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // One fetch per scope, cached for the session. The dialog stays usable while it
  // lands: a query against an empty index shows "no files" for a beat, which is the
  // honest state rather than a spinner over a list that is about to appear.
  useEffect(() => {
    if (indexCache.has(scope)) return;
    let cancelled = false;
    void fetchQuickOpenIndex(root, repo).then((entries) => {
      if (cancelled) return;
      indexCache.set(scope, entries);
      setIndex(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, root, repo]);

  const matches = useMemo(() => rankQuickOpen(index, query), [index, query]);

  useEffect(() => {
    setActiveIndex((previous) => Math.min(previous, Math.max(matches.length - 1, 0)));
  }, [matches.length]);

  const commit = (entry: QuickOpenEntry | undefined) => {
    if (!entry) return;
    onOpen(entry.path);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(matches[activeIndex]);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((previous) => (matches.length === 0 ? 0 : (previous + 1) % matches.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((previous) => (matches.length === 0 ? 0 : (previous - 1 + matches.length) % matches.length));
    }
  };

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-lg"
      header={<span className="text-sm font-semibold text-ink">Open file</span>}
    >
      <div className="px-4 py-3 space-y-2">
        <input
          ref={inputRef}
          value={query}
          onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          onKeyDown={onKeyDown}
          placeholder="Search by file name"
          aria-label="File name"
          className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 text-xs font-mono text-ink outline-none focus:border-ink/40"
        />
        <div className="max-h-[45vh] overflow-y-auto scrollbar-overlay-container rounded border border-ink/10 divide-y divide-ink/5">
          {matches.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-ink/40 font-mono">
              {index.length === 0 ? 'Reading the file index…' : 'No file matches'}
            </div>
          ) : (
            matches.map((entry, position) => (
              <button
                key={entry.path}
                type="button"
                onClick={() => commit(entry)}
                onMouseEnter={() => setActiveIndex(position)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                  position === activeIndex ? 'bg-ink/10' : 'hover:bg-ink/5'
                }`}
              >
                <FileIcon name={entry.name} size={13} className="flex-shrink-0 opacity-70" />
                <span className="text-xs font-mono text-ink truncate">{entry.name}</span>
                {entry.directory ? (
                  <span className="text-[10px] font-mono text-ink/40 truncate ml-auto">{entry.directory}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}
