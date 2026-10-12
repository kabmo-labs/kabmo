/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Creating one empty file in a named folder of the Files panel, and opening it.
 *
 * Extracted from `useFileActions` because the Files panel needs the SAME flow
 * from two places that share no target: a row's context menu (create beside the
 * folder that was right-clicked) and the panel's own background (create at the
 * root). A second copy would drift on the two things that matter — a refusal
 * keeps the dialog open with the server's reason beside the field, and a success
 * OPENS the file, because the user asked for something to work on.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { FormEvent } from 'preact/compat';
import { useFetcher } from '@/client/lib/router/fetcher';

/** The shape `/api/fs/action` answers a create with. */
interface CreateResponse {
  success?: boolean;
  /** Relative path of the file that was created. */
  path?: string;
  error?: string;
}

export interface FileCreateDeps {
  /** Folder the file goes in, relative to the listed root (`.` for the root). */
  folderPath: string;
  rootPath?: string;
  repo?: string;
  /** Fired after the file exists, so the tree re-reads. */
  onCreated: () => void;
  /** Fired with the new file's relative path, so the panel can open its tab. */
  onOpenCreated?: (file: { path: string; name: string }) => void;
}

export interface FileCreate {
  open: boolean;
  name: string;
  setName: (value: string) => void;
  /** The server's refusal, rendered inside the dialog. */
  error: string | null;
  busy: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  submit: (event: FormEvent) => void;
}

export function useFileCreate({ folderPath, rootPath, repo, onCreated, onOpenCreated }: FileCreateDeps): FileCreate {
  const fetcher = useFetcher<CreateResponse>();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  /**
   * The response already acted on. The fetcher keeps `data` until the next
   * request, and `onCreated` re-renders this hook with a fresh callback
   * identity — an unguarded effect would re-run for the SAME response forever
   * and re-open the file on every render, pinning the tab.
   */
  const handledRef = useRef<CreateResponse | null>(null);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    const data = fetcher.data;
    if (handledRef.current === data) return;
    handledRef.current = data;
    // The fetcher parses the body whatever the status, so a refusal arrives as
    // `data.error` rather than as a throw — which is what keeps the dialog open.
    if (data.success && data.path) {
      setOpen(false);
      setName('');
      setError(null);
      onCreated();
      onOpenCreated?.({ path: data.path, name: data.path.split('/').pop() || data.path });
    } else {
      setError(data.error || 'Could not create the file');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  return {
    open,
    name,
    setName,
    error,
    busy: fetcher.state !== 'idle',
    openDialog: () => {
      setName('');
      setError(null);
      setOpen(true);
    },
    closeDialog: () => setOpen(false),
    submit: (event: FormEvent) => {
      event.preventDefault();
      const trimmed = name.trim();
      if (!trimmed) return;
      setError(null);
      const formData = new FormData();
      formData.append('actionType', 'create');
      formData.append('path', folderPath);
      formData.append('name', trimmed);
      if (repo && repo !== '.') formData.append('repo', repo);
      if (rootPath) formData.append('root', rootPath);
      void fetcher.submit(formData, { method: 'post', action: '/api/fs/action' });
    },
  };
}
