import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

interface UseFileDiffOptions {
  filePath: string;
  status: string;
  isStaged: boolean;
  repo: string;
  root?: string;
}

export interface FileDiffState {
  rawDiff: string;
  /** The document before the change (HEAD, or the index for an unstaged read). */
  oldContent: string;
  /** The document after it (the working file). */
  newContent: string;
  currentStatus: string;
  currentStaged: boolean;
  isLoading: boolean;
  errorMessage: string | null;
  /** Re-read the patch; overrides apply to this read only. */
  fetchDiff: (overrides?: { staged?: boolean; status?: string }) => Promise<void>;
  /** Adopt a staged/status pair the caller just changed (a stage/unstage). */
  adoptState: (next: { staged?: boolean; status?: string }) => void;
}

/**
 * The diff panel's read: the patch, the status it was read under, and the two
 * pieces of state the toolbar's actions move.
 *
 * Split out of `DiffPanel` because that module is at the repo's line ceiling
 * and because the sequencing here is the part with the bugs in it — a slower
 * earlier read overwriting a newer one, and a dependency on the staged/status
 * copies re-keying the callback and firing a fetch per render.
 */
export function useFileDiff({ filePath, status, isStaged, repo, root }: UseFileDiffOptions): FileDiffState {
  const [rawDiff, setRawDiff] = useState<string>('');
  const [oldContent, setOldContent] = useState<string>('');
  const [newContent, setNewContent] = useState<string>('');
  const [currentStatus, setCurrentStatus] = useState<string>(status);
  const [currentStaged, setCurrentStaged] = useState<boolean>(isStaged);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  /**
   * The staged flag / status the next fetch must ask for. The state copies lag
   * a click by a render, and keeping them in `fetchDiff`'s dependency list made
   * every response re-key the callback and fire another fetch. Refs keep the
   * callback stable and always read the post-action value.
   */
  const stagedRef = useRef<boolean>(isStaged);
  const statusRef = useRef<string>(status);
  const fetchSeqRef = useRef(0);

  const fetchDiff = useCallback(async (overrides: { staged?: boolean; status?: string } = {}) => {
    if (!filePath) return;
    const seq = ++fetchSeqRef.current;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const staged = overrides.staged ?? stagedRef.current;
      const statusForFetch = overrides.status ?? statusRef.current;
      const params = new URLSearchParams({
        fileDiff: '1',
        file: filePath,
        staged: staged ? '1' : '0',
        repo: repo || '.',
      });
      // No `fullContext`: the panel renders both SIDES of the file now, and
      // how much of them is shown is a client-side collapse. Asking the server
      // for the whole file as a patch would be a second answer to that question.
      if (statusForFetch) params.set('status', statusForFetch);
      if (root) params.set('root', root);

      const res = await fetch(`/api/fs/git?${params.toString()}`);
      const data = (await res.json().catch(() => null)) as {
        success?: boolean;
        diff?: string;
        oldContent?: string;
        newContent?: string;
        status?: string;
        staged?: boolean;
        error?: string;
      } | null;
      // A slower earlier read must not overwrite a newer one (the action path
      // fires a fetch of its own while the initial one is still in flight).
      if (seq !== fetchSeqRef.current) return;
      if (data?.success) {
        setRawDiff(data.diff || '');
        // Both sides travel on every read: the merge view compares documents,
        // and a whitespace fold has to be applied to the ORIGINAL, not to the
        // patch (see `foldWhitespaceOnly`).
        setOldContent(data.oldContent ?? '');
        setNewContent(data.newContent ?? '');
        if (data.status) {
          statusRef.current = data.status;
          setCurrentStatus(data.status);
        }
        if (typeof data.staged === 'boolean') {
          stagedRef.current = data.staged;
          setCurrentStaged(data.staged);
        }
      } else {
        setErrorMessage(data?.error || `Failed to load file diff (HTTP ${res.status})`);
      }
    } catch (err: unknown) {
      if (seq !== fetchSeqRef.current) return;
      setErrorMessage(err instanceof Error ? err.message : 'Error fetching diff');
    } finally {
      if (seq === fetchSeqRef.current) setIsLoading(false);
    }
  }, [filePath, repo, root]);

  useEffect(() => {
    setCurrentStatus(status);
    setCurrentStaged(isStaged);
    stagedRef.current = isStaged;
    statusRef.current = status;
  }, [status, isStaged, filePath]);

  useEffect(() => {
    void fetchDiff();
  }, [fetchDiff]);

  const adoptState = useCallback((next: { staged?: boolean; status?: string }) => {
    if (typeof next.staged === 'boolean') {
      stagedRef.current = next.staged;
      setCurrentStaged(next.staged);
    }
    if (next.status) {
      statusRef.current = next.status;
      setCurrentStatus(next.status);
    }
  }, []);

  return {
    rawDiff,
    oldContent,
    newContent,
    currentStatus,
    currentStaged,
    isLoading,
    errorMessage,
    fetchDiff,
    adoptState,
  };
}
