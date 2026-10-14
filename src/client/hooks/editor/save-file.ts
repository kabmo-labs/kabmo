/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The write half of the file-editing contract: POST one buffer to
 * `/api/fs/action` and report whether the server took it.
 *
 * Kept out of `useFileEditor` because the multipart shape, the scope fields and
 * the failure rule are one self-contained concern, and because the hook carries
 * the read, cache and history concerns already.
 */

import type { LineEnding } from '@/shared/lib/code/line-endings';
import { writeThroughHandle, type HandleWriteResult } from '@/client/lib/launch/file-handlers';

interface SavableFile {
  path?: string;
  root?: string;
  repo?: string;
  handleId?: string;
}

/**
 * Writes `lfText` to `file.path` in the file's own `eol`. Returns false on any
 * refusal — a non-2xx response, an `error` body, or a dropped connection —
 * because the caller's only decision is whether to mark the buffer clean.
 *
 * The ending travels as its own field and the server rebuilds the bytes: a
 * multipart body normalizes bare LF to CRLF, so the payload cannot carry the
 * distinction itself.
 *
 * A file a PWA launch (or a Finder drop) handed over has NO server-reachable
 * path — its `path` is only a display name — so the write goes through the live
 * handle instead. Sending it to `/api/fs/action` would resolve that name
 * against the default root and write an unrelated file, which is why the branch
 * comes first and a missing handle is a REFUSAL rather than a fallback.
 *
 * `interactive` says whether a user gesture is behind this call (a click, a
 * Ctrl+S) or a timer (the autosave). It is passed straight through because the
 * handle write needs the distinction to decide between asking for permission
 * and reporting that a click is required — see `writeThroughHandle`.
 */
export async function saveEditorFile(
  file: SavableFile,
  lfText: string,
  eol: LineEnding,
  options: { interactive: boolean } = { interactive: false },
): Promise<HandleWriteResult> {
  if (file.handleId) {
    // The disk bytes carry the file's own ending; the buffer is LF-only.
    return writeThroughHandle(
      file.handleId,
      eol === 'crlf' ? lfText.replace(/\n/g, '\r\n') : lfText,
      { interactive: options.interactive },
    );
  }
  if (!file.path) return 'failed';
  const formData = new FormData();
  formData.append('actionType', 'save');
  formData.append('path', file.path);
  formData.append('content', lfText);
  formData.append('eol', eol);
  if (file.root) formData.append('root', file.root);
  if (file.repo && file.repo !== '.') formData.append('repo', file.repo);
  try {
    const res = await fetch('/api/fs/action', { method: 'POST', body: formData });
    const data = await res.json().catch(() => null);
    return res.ok && data?.success ? 'written' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Keeps only `keep`'s keys, returning the same object when nothing was
 * dropped so a render whose tab set is unchanged does not re-key its children.
 */
export function retainKeys<T>(record: Record<string, T>, keep: Set<string>): Record<string, T> {
  const keys = Object.keys(record);
  if (keys.every((key) => keep.has(key))) return record;
  const next: Record<string, T> = {};
  for (const key of keys) {
    if (keep.has(key)) next[key] = record[key];
  }
  return next;
}
