/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's archive dialogs: the draft a modal edits, the server call
 * it submits, and the format list this machine can actually write.
 *
 * The format list is READ from `/api/fs/archive` rather than hardcoded, because
 * `rar` and `7z` are binaries the machine may not have and a dialog that offers
 * them would only produce a refusal after the user typed a name. When the read
 * fails the full list is still offered — the server's own refusal is the honest
 * answer, and hiding every format because one probe failed is worse.
 *
 * A refusal keeps the dialog OPEN with the server's words beside the field,
 * exactly like Create and Rename: "already exists" is a message about what to
 * type next, not a notification about something that happened.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useFetcher } from '@/client/lib/router/fetcher';
import type { ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import {
  COMPRESS_FORMATS,
  defaultArchiveDestination,
  defaultArchiveName,
  defaultExtractDestination,
  type ArchiveFormat,
} from '@/shared/lib/fs/archive';

/** What the capability route answers. */
interface ArchiveFormatAvailability {
  id: ArchiveFormat;
  label: string;
  extension: string;
  available: boolean;
  tool: string;
}

interface ArchiveResponse {
  success?: boolean;
  path?: string;
  error?: string;
}

export interface CompressDraft {
  entries: ClipboardTarget[];
  format: ArchiveFormat;
  name: string;
  destination: string;
}

export interface ExtractDraft {
  archive: ClipboardTarget;
  destination: string;
}

export interface FileArchiveDeps {
  rootPath?: string;
  repo: string;
  /** Fired after an archive landed or a folder was unpacked. */
  onComplete: () => void;
}

export interface FileArchive {
  formats: ArchiveFormatAvailability[];
  compress: CompressDraft | null;
  extract: ExtractDraft | null;
  /** The server's refusal for the open dialog. */
  error: string | null;
  busy: boolean;
  openCompress: (entries: readonly ClipboardTarget[]) => void;
  openExtract: (archive: ClipboardTarget) => void;
  setFormat: (format: ArchiveFormat) => void;
  setName: (name: string) => void;
  setCompressDestination: (destination: string) => void;
  setExtractDestination: (destination: string) => void;
  cancel: () => void;
  submitCompress: () => void;
  submitExtract: () => void;
}

const FALLBACK_FORMATS: ArchiveFormatAvailability[] = COMPRESS_FORMATS.map((entry) => ({
  ...entry,
  available: true,
  tool: entry.id,
}));

export function useFileArchive({ rootPath, repo, onComplete }: FileArchiveDeps): FileArchive {
  const fetcher = useFetcher<ArchiveResponse>();
  const [formats, setFormats] = useState<ArchiveFormatAvailability[]>(FALLBACK_FORMATS);
  const [compress, setCompress] = useState<CompressDraft | null>(null);
  const [extract, setExtract] = useState<ExtractDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Whether the response in flight came from the compress or extract dialog. */
  const pendingRef = useRef<'compress' | 'extract' | null>(null);
  /** The response already acted on; the fetcher keeps `data` until the next call. */
  const handledRef = useRef<ArchiveResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/fs/archive');
        const body = (await res.json()) as { formats?: ArchiveFormatAvailability[] };
        if (!cancelled && Array.isArray(body.formats) && body.formats.length > 0) setFormats(body.formats);
      } catch {
        // Keep the fallback list; the server's refusal names a missing tool.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    const data = fetcher.data;
    if (handledRef.current === data) return;
    handledRef.current = data;
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (data.success) {
      setError(null);
      if (pending === 'compress') setCompress(null);
      if (pending === 'extract') setExtract(null);
      onComplete();
    } else if (pending) {
      setError(data.error || 'The archive request failed');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const post = useCallback((fields: Record<string, string>) => {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) formData.append(key, value);
    if (repo && repo !== '.') formData.append('repo', repo);
    if (rootPath) formData.append('root', rootPath);
    void fetcher.submit(formData, { method: 'post', action: '/api/fs/action' });
  }, [fetcher, repo, rootPath]);

  const openCompress = useCallback((entries: readonly ClipboardTarget[]) => {
    if (entries.length === 0) return;
    // Zip first when the machine can write it, otherwise the first writer it
    // has: a dialog that opens on a format the server cannot run is a refusal
    // the user has to discover by submitting.
    const format = formats.find((option) => option.id === 'zip' && option.available)?.id
      ?? formats.find((option) => option.available)?.id
      ?? 'zip';
    setError(null);
    setExtract(null);
    setCompress({
      entries: entries.map(({ path, name, kind }) => ({ path, name, kind })),
      format,
      name: defaultArchiveName(entries, format),
      destination: defaultArchiveDestination(entries),
    });
  }, [formats]);

  const openExtract = useCallback((archive: ClipboardTarget) => {
    setError(null);
    setCompress(null);
    setExtract({ archive, destination: defaultExtractDestination(archive.path) });
  }, []);

  const setFormat = useCallback((format: ArchiveFormat) => {
    setCompress((current) => {
      if (!current) return current;
      // Only rewrite the name when it is still the one the dialog proposed;
      // a name the user typed is theirs, even if the extension disagrees.
      const proposed = defaultArchiveName(current.entries, current.format);
      const name = current.name === proposed ? defaultArchiveName(current.entries, format) : current.name;
      return { ...current, format, name };
    });
  }, []);

  return {
    formats,
    compress,
    extract,
    error,
    busy: fetcher.state !== 'idle',
    openCompress,
    openExtract,
    setFormat,
    setName: (name) => setCompress((current) => current && { ...current, name }),
    setCompressDestination: (destination) => setCompress((current) => current && { ...current, destination }),
    setExtractDestination: (destination) => setExtract((current) => current && { ...current, destination }),
    cancel: () => {
      setCompress(null);
      setExtract(null);
      setError(null);
    },
    submitCompress: () => {
      const draft = compress;
      if (!draft) return;
      pendingRef.current = 'compress';
      setError(null);
      post({
        actionType: 'compress',
        format: draft.format,
        name: draft.name.trim(),
        destination: draft.destination.trim() || '.',
        paths: JSON.stringify(draft.entries.map((entry) => entry.path)),
      });
    },
    submitExtract: () => {
      const draft = extract;
      if (!draft) return;
      pendingRef.current = 'extract';
      setError(null);
      post({
        actionType: 'extract',
        path: draft.archive.path,
        destination: draft.destination.trim() || '.',
      });
    },
  };
}
