/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The browse state the New Workspace modal's location bar drives: which
 * directory is being listed, its subfolders, and the in-flight/error state of
 * the last read.
 *
 * It lives in a hook rather than in the modal because the refresh button, the
 * path field, entering a subfolder and the initial open are four callers of
 * the same read — and because the modal itself is close to the file-size
 * ceiling.
 *
 * `current` is deliberately the SERVER's resolved path, never the string the
 * user typed: `~` expands server-side, so adopting the echo is what makes the
 * field, the listing and a later mkdir/clone agree about one directory.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { fetchDirectories, type DirectoryEntry } from '@/shared/lib/fs/browse';

export interface DirectoryBrowse {
  /** The directory currently listed (server-resolved). */
  current: string;
  directories: DirectoryEntry[];
  parentPath: string | null;
  loading: boolean;
  error: string | null;
  /** Read a directory (or the browse root when omitted) and adopt its listing. */
  navigate: (target?: string) => Promise<void>;
  /** Read the current directory again — the refresh button. */
  refresh: () => Promise<void>;
}

export function useDirectoryBrowse(initialPath?: string): DirectoryBrowse {
  const [current, setCurrent] = useState(initialPath ?? '');
  const [directories, setDirectories] = useState<DirectoryEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a response that arrives after the modal closed or a later read
  // started: the last read issued is the only one allowed to write state.
  const requestRef = useRef(0);

  const navigate = useCallback(async (target?: string) => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await fetchDirectories(target);
      if (request !== requestRef.current) return;
      setCurrent(data.path ?? target ?? '');
      setParentPath(data.parentPath ?? null);
      setDirectories(data.directories ?? []);
    } catch (e) {
      if (request !== requestRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setDirectories([]);
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  // The initial read happens on MOUNT. The form is mounted fresh on every open
  // (see `NewWorkspaceModal`), so "mount" and "the user opened the dialog" are
  // the same moment — and reading here rather than in an effect keyed on an
  // open flag means the listing cannot be fetched for a render the user has
  // already moved past.
  useEffect(() => {
    void navigate(initialPath || undefined);
    // `initialPath` is deliberately read once, at mount: re-reading on every
    // keystroke of the path field would re-list the tree as the user types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const refresh = useCallback(() => navigate(current || undefined), [navigate, current]);

  return { current, directories, parentPath, loading, error, navigate, refresh };
}
