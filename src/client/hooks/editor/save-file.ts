/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The write-conflict verdict: "the file on disk moved since you read it".
 *
 * The save path wrote unconditionally, so two tabs on one file — or one tab and a
 * tool call — silently last-writer-wins. The read route now reports the file's
 * `mtimeMs`, the save sends it back as `baseMtime`, and the server refuses with
 * `409` when the bytes on disk are not the ones the buffer was built from.
 *
 * Three rules make this safe rather than annoying:
 *
 * - **A save with no `baseMtime` keeps the old behaviour.** A handle-backed file
 *   (a PWA launch) has no server path and no mtime to send, and an older client
 *   sends none; neither may be turned into a refusal.
 * - **A file that does not exist yet is not a conflict.** Creating the file the
 *   tab names is what `confirmSaveMissing` exists to allow, and `mtimeMs` is
 *   `null` there.
 * - **A refusal is a VERDICT, not a failure.** It carries the current mtime, so
 *   the panel can offer "Reload" (discard mine) or "Keep mine" (write anyway,
 *   passing the new mtime) instead of reporting that the save failed.
 */

import type { LineEnding } from '@/shared/lib/code/line-endings';
import { writeThroughHandle, type HandleWriteResult } from '@/client/lib/launch/file-handlers';

interface SavableFile {
  path?: string;
  root?: string;
  repo?: string;
  handleId?: string;
}

/** What a save attempt answers. */
export type SaveOutcome =
  | { status: 'written' }
  /** The buffer is behind the disk copy: `diskMtimeMs` is what is there now. */
  | { status: 'conflict'; diskMtimeMs: number | null }
  /** The write was refused for a reason that is not a conflict (a 4xx/5xx, a drop). */
  | { status: 'failed' }
  /** A handle-backed file needs a user gesture to grant write access. */
  | { status: 'needs-permission' };

/** The shape `/api/fs/action` answers for a save. */
interface SaveResponse {
  success?: unknown;
  error?: unknown;
  /** Present on a `409`: the mtime the file holds now. */
  mtimeMs?: unknown;
  conflict?: unknown;
}

/**
 * Writes `lfText` to `file.path` in the file's own `eol`.
 *
 * The ending travels as its own field and the server rebuilds the bytes: a
 * multipart body normalizes bare LF to CRLF, so the payload cannot carry the
 * distinction itself.
 *
 * A file a PWA launch (or a Finder drop) handed over has NO server-reachable
 * path — its `path` is only a display name — so the write goes through the live
 * handle instead. Sending it to `/api/fs/action` would resolve that name against
 * the default root and write an unrelated file, which is why the branch comes
 * first and a missing handle is a REFUSAL rather than a fallback.
 *
 * `interactive` says whether a user gesture is behind this call (a click, a
 * Ctrl+S) or a timer (the autosave). It is passed straight through because the
 * handle write needs the distinction to decide between asking for permission and
 * reporting that a click is required.
 *
 * `baseMtimeMs` is the mtime the buffer was read from. Omit it for a handle write
 * and for a caller that has none; the server then writes unconditionally, which
 * is the pre-existing contract.
 */
export async function saveEditorFile(
  file: SavableFile,
  lfText: string,
  eol: LineEnding,
  options: { interactive: boolean; baseMtimeMs?: number | null },
): Promise<SaveOutcome> {
  if (file.handleId) {
    const result: HandleWriteResult = await writeThroughHandle(
      file.handleId,
      eol === 'crlf' ? lfText.replace(/\n/g, '\r\n') : lfText,
      { interactive: options.interactive },
    );
    if (result === 'written') return { status: 'written' };
    if (result === 'needs-permission') return { status: 'needs-permission' };
    return { status: 'failed' };
  }
  if (!file.path) return { status: 'failed' };

  const formData = new FormData();
  formData.append('actionType', 'save');
  formData.append('path', file.path);
  formData.append('content', lfText);
  formData.append('eol', eol);
  if (file.root) formData.append('root', file.root);
  if (file.repo && file.repo !== '.') formData.append('repo', file.repo);
  // `null`/absent is deliberately NOT sent: the server treats a missing field as
  // "no expectation", and sending the string "null" would fail every save.
  if (typeof options.baseMtimeMs === 'number') formData.append('baseMtime', String(options.baseMtimeMs));

  try {
    const res = await fetch('/api/fs/action', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => null)) as SaveResponse | null;
    if (res.status === 409) {
      const diskMtimeMs = typeof data?.mtimeMs === 'number' ? data.mtimeMs : null;
      return { status: 'conflict', diskMtimeMs };
    }
    if (res.ok && data?.success) return { status: 'written' };
    return { status: 'failed' };
  } catch {
    return { status: 'failed' };
  }
}

/**
 * Keeps only `keep`'s keys, returning the same object when nothing was dropped so
 * a render whose tab set is unchanged does not re-key its children.
 */
export function retainKeys<T>(record: Record<string, T>, keep: Set<string>): Record<string, T> {
  const next: Record<string, T> = {};
  let dropped = false;
  for (const [key, value] of Object.entries(record)) {
    if (keep.has(key)) next[key] = value;
    else dropped = true;
  }
  return dropped ? next : record;
}
