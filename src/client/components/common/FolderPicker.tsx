/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * FolderPicker — modal directory browser used by "New Workspace" to choose a
 * project path. Lists subdirectories via /api/fs/browse (server-side, starts
 * at the OS home), supports manual path entry and parent navigation, and
 * returns the selected absolute path.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { FormEvent } from 'preact/compat';
import { ChevronRight, Folder, FolderOpen, Home, Loader2, RefreshCw, X } from 'lucide-preact';
import { fetchDirectories, type DirectoryEntry } from '@/shared/lib/fs/browse';

interface FolderPickerProps {
  /** The folder to start browsing from (defaults to home). */
  initialPath?: string;
  /** Called when the user confirms a folder. */
  onSelect: (path: string) => void;
  /** Called when the user dismisses the picker. */
  onClose: () => void;
}

/**
 * `/api/fs/browse` is read through the shared fetcher (`@/shared/lib/fs/browse`)
 * rather than a local one, because the New Workspace modal renders the same
 * listing and a second copy of the response shape is how the two drift.
 */

export function FolderPicker({ initialPath, onSelect, onClose }: FolderPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath ?? '');
  const [pathInput, setPathInput] = useState('');
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const navigate = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDirectories(target);
      setCurrentPath(data.path ?? target ?? '');
      setParentPath(data.parentPath ?? null);
      setPathInput(data.path ?? target ?? '');
      setDirectories(data.directories ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void navigate(initialPath);
  }, [initialPath, navigate]);

  const handleGoUp = () => {
    if (parentPath) void navigate(parentPath);
  };

  const handlePathSubmit = (e: FormEvent) => {
    e.preventDefault();
    const candidate = pathInput.trim();
    if (candidate) void navigate(candidate);
  };

  const handleOpenDir = (dir: DirectoryEntry) => {
    void navigate(dir.path);
  };

  const handlePick = (dir: DirectoryEntry) => {
    setSelectedPath(dir.path);
    onSelect(dir.path);
  };

  const handlePickCurrent = () => {
    if (currentPath) {
      setSelectedPath(currentPath);
      onSelect(currentPath);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-ink/30 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-ink/15 rounded-lg shadow-2xl w-full max-w-lg flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-ink/10">
          <h3 className="font-semibold text-sm flex items-center space-x-2">
            <FolderOpen size={15} className="text-ink/70" />
            <span>Choose Project Folder</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-ink/10 text-ink/60 hover:text-ink transition-colors"
            aria-label="Close picker"
          >
            <X size={15} />
          </button>
        </div>

        {/* Path bar */}
        <div className="px-4 py-2 border-b border-ink/10 bg-canvas/50">
          <form onSubmit={handlePathSubmit} className="flex items-center space-x-2">
            <Home size={14} className="text-ink/40 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.currentTarget.value)}
              placeholder="~ or /absolute/path"
              className="flex-1 bg-transparent outline-none text-xs font-mono text-ink placeholder-ink/30 py-1"
              spellcheck={false}
            />
            <button
              type="submit"
              className="px-2 py-1 rounded bg-ink/5 border border-ink/10 text-[11px] font-medium hover:bg-ink/10 transition-colors"
            >
              Go
            </button>
          </form>
          <div className="flex items-center space-x-1 mt-1 text-[11px] text-ink/40 truncate">
            <button
              type="button"
              onClick={() => void navigate()}
              className="hover:text-ink transition-colors flex items-center"
            >
              <Home size={11} className="mr-0.5" /> home
            </button>
            {currentPath.split('/').filter(Boolean).map((seg, idx, arr) => {
              const pathUpTo = '/' + currentPath.split('/').filter(Boolean).slice(0, idx + 1).join('/');
              const isLast = idx === arr.length - 1;
              return (
                <span key={pathUpTo} className="flex items-center space-x-1 min-w-0">
                  <ChevronRight size={10} className="text-ink/20 flex-shrink-0" />
                  {isLast ? (
                    <span className="text-ink/70 truncate">{seg}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void navigate(pathUpTo)}
                      className="hover:text-ink transition-colors truncate max-w-[120px]"
                    >
                      {seg}
                    </button>
                  )}
                </span>
              );
            })}
          </div>
        </div>

        {/* Directory list */}
        <div className="flex-1 min-h-[240px] max-h-[360px] scrollbar-overlay-container p-2">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-ink/40">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-40 text-xs text-red-600 space-y-2 px-4">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void navigate(currentPath || undefined)}
                className="px-2 py-1 rounded bg-ink/5 border border-ink/10 text-ink/70 hover:bg-ink/10 flex items-center space-x-1"
              >
                <RefreshCw size={11} /> Retry
              </button>
            </div>
          ) : directories.length === 0 ? (
            <div className="text-center py-16 text-xs text-ink/40">No subfolders</div>
          ) : (
            directories.map((dir) => (
              <div
                key={dir.path}
                className={`group flex items-center justify-between px-2.5 py-2 rounded cursor-pointer transition-colors ${
                  selectedPath === dir.path ? 'bg-ink/10' : 'hover:bg-ink/5'
                }`}
                onDblClick={() => handleOpenDir(dir)}
              >
                <button
                  type="button"
                  onClick={() => handleOpenDir(dir)}
                  className="flex items-center space-x-2 min-w-0 flex-1 text-left"
                >
                  <Folder size={15} className="text-ink/50 flex-shrink-0" />
                  <span className="text-xs truncate text-ink/85">{dir.name}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handlePick(dir)}
                  className="touch-shown-flex hidden group-hover:flex px-2 py-0.5 rounded bg-ink text-canvas text-[10px] font-semibold hover:bg-ink/80 transition-colors flex-shrink-0"
                >
                  Choose
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-ink/10">
          <div className="flex items-center space-x-2 min-w-0">
            <button
              type="button"
              onClick={handleGoUp}
              disabled={!parentPath}
              className="px-2.5 py-1.5 rounded bg-ink/5 border border-ink/10 text-[11px] font-medium hover:bg-ink/10 disabled:opacity-40 transition-colors flex items-center space-x-1"
            >
              <span>↑</span>
              <span>Up</span>
            </button>
            <button
              type="button"
              onClick={() => void navigate()}
              className="px-2.5 py-1.5 rounded bg-ink/5 border border-ink/10 text-[11px] font-medium hover:bg-ink/10 transition-colors"
            >
              Home
            </button>
          </div>
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium text-ink/60 hover:text-ink transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handlePickCurrent}
              disabled={!currentPath}
              className="px-3.5 py-1.5 text-xs font-medium bg-ink text-canvas rounded hover:bg-ink/90 disabled:opacity-50 transition-colors"
            >
              Use This Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
