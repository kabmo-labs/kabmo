/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Files panel's clipboard: what Cut/Copy put aside, and the Paste,
 * Duplicate and Cut/Copy requests that act on it.
 *
 * Owned by the PANEL and handed down to the rows, rather than read per row: a
 * tree can hold hundreds of rows, and a subscription in each one would be
 * hundreds of listeners for a value that changes on a right-click. The rows get
 * the entry and the callbacks as props, the same way they get the git maps.
 *
 * The entry is per SESSION (`files.clipboard`), and it carries the listing it
 * was taken from — a paste into another workspace or nested repo is refused by
 * scope rather than moving a file the user copied somewhere else. A CUT is
 * cleared once its paste lands; a copy stays, so one entry can be pasted many
 * times, which is what a copy is for.
 *
 * Every refusal is REPORTED (`onError` → the panel's toast): a paste that did
 * nothing because the folder is its own ancestor, or because the file was
 * deleted in the meantime, has to say so — the tree looks identical either way.
 */

import { useCallback, useEffect, useRef } from 'preact/hooks';
import { useFetcher } from '@/client/lib/router/fetcher';
import { useSessionState } from '@/client/hooks/workspace/session-state';
import {
  fsClipboardScope,
  pasteRefusal,
  pasteTargetDir,
  readFsClipboard,
  type FsClipboard,
} from '@/shared/lib/fs/clipboard';

/** The shape `/api/fs/action` answers a transfer with. */
interface TransferResponse {
  success?: boolean;
  path?: string;
  error?: string;
}

export interface ClipboardTarget {
  path: string;
  name: string;
  kind: 'file' | 'folder';
}

export interface FileClipboard {
  clip: FsClipboard | null;
  /** True while a transfer is in flight; the menu rows disable on it. */
  busy: boolean;
  /** The reason a paste onto this target would be refused, or null when legal. */
  refusalFor: (target: ClipboardTarget) => string | null;
  copy: (target: ClipboardTarget) => void;
  cut: (target: ClipboardTarget) => void;
  duplicate: (target: ClipboardTarget) => void;
  paste: (target: ClipboardTarget) => void;
}

export interface FileClipboardDeps {
  rootPath?: string;
  repo: string;
  /** Fired after a transfer landed, so the tree re-reads. */
  onComplete: () => void;
  /** A refusal, in the words the server or the rule used. */
  onError: (message: string) => void;
}

export function useFileClipboard({ rootPath, repo, onComplete, onError }: FileClipboardDeps): FileClipboard {
  const fetcher = useFetcher<TransferResponse>();
  const [storedClip, setStoredClip] = useSessionState<unknown>('files.clipboard', null);
  const clip = readFsClipboard(storedClip);
  const scope = fsClipboardScope(rootPath, repo);
  /**
   * Whether the request in flight is a CUT's paste, which clears the clipboard
   * when it lands. Read by the effect below at the moment the response arrives,
   * so a later request cannot retroactively clear a fresh copy.
   */
  const clearsClipRef = useRef(false);
  /**
   * The response already acted on. The fetcher keeps `data` until the next
   * request and `onComplete` re-renders this hook with a fresh callback
   * identity, so an unguarded effect would re-run for the same payload forever
   * — the same trap `useFileCreate` documents.
   */
  const handledRef = useRef<TransferResponse | null>(null);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    const data = fetcher.data;
    if (handledRef.current === data) return;
    handledRef.current = data;
    const clearClip = clearsClipRef.current;
    clearsClipRef.current = false;
    if (data.success) {
      if (clearClip) setStoredClip(null);
      onComplete();
    } else {
      onError(data.error || 'The transfer did not complete');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const post = useCallback((fields: Record<string, string>, clearsClip: boolean) => {
    clearsClipRef.current = clearsClip;
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.append(key, value);
    if (repo && repo !== '.') formData.append('repo', repo);
    if (rootPath) formData.append('root', rootPath);
    void fetcher.submit(formData, { method: 'post', action: '/api/fs/action' });
  }, [fetcher, repo, rootPath]);

  const refusalFor = useCallback(
    (target: ClipboardTarget): string | null => pasteRefusal(clip, scope, pasteTargetDir(target.path, target.kind)),
    [clip, scope],
  );

  return {
    clip,
    busy: fetcher.state !== 'idle',
    refusalFor,
    copy: (target) => {
      setStoredClip({ scope, path: target.path, name: target.name, kind: target.kind, mode: 'copy' });
    },
    cut: (target) => {
      setStoredClip({ scope, path: target.path, name: target.name, kind: target.kind, mode: 'cut' });
    },
    duplicate: (target) => {
      post({ actionType: 'duplicate', path: target.path }, false);
    },
    paste: (target) => {
      if (!clip) return;
      const refusal = refusalFor(target);
      if (refusal) {
        onError(refusal);
        return;
      }
      post(
        {
          actionType: 'paste',
          sourcePath: clip.path,
          mode: clip.mode,
          targetPath: target.path,
          targetKind: target.kind,
        },
        clip.mode === 'cut',
      );
    },
  };
}
