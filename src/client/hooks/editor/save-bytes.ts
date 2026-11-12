/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing a BINARY document back to disk — the workbook the grid edited.
 *
 * The text save path (`save-file.ts`) cannot carry these bytes: its payload is a
 * multipart text field, which is UTF-8 and normalizes line endings, so a ZIP
 * container would arrive corrupted. The bytes therefore travel as a Blob, and
 * the server writes them verbatim.
 *
 * The two origins are the same two the read path has: a workspace path goes
 * through `/api/fs/action`, and a file the OS handed over has no server path —
 * only a live handle — so it is written through `createWritable`.
 *
 * `baseMtimeMs` is the conflict base, exactly as the text path sends it. A
 * binary viewer has no mtime from its read (`/api/fs/raw` does not report one),
 * so it omits the field and the write is unconditional — the pre-existing
 * contract for a save with no expectation.
 */

import { writeThroughHandle } from '@/client/lib/launch/file-handlers';

export interface SavableBytesTarget {
  path?: string;
  root?: string;
  repo?: string;
  handleId?: string;
}

export type BytesSaveOutcome =
  | { status: 'written'; mtimeMs: number | null }
  | { status: 'conflict'; diskMtimeMs: number | null }
  | { status: 'needs-permission' }
  | { status: 'failed'; error: string | null };

interface SaveBytesResponse {
  success?: unknown;
  error?: unknown;
  mtimeMs?: unknown;
}

export async function saveFileBytes(
  target: SavableBytesTarget,
  bytes: Uint8Array,
  options: { interactive: boolean; baseMtimeMs?: number | null },
): Promise<BytesSaveOutcome> {
  if (target.handleId) {
    const result = await writeThroughHandle(target.handleId, bytes, { interactive: options.interactive });
    if (result === 'written') return { status: 'written', mtimeMs: null };
    if (result === 'needs-permission') return { status: 'needs-permission' };
    return { status: 'failed', error: 'The browser refused the write.' };
  }
  if (!target.path) return { status: 'failed', error: 'This file has no path to write to.' };

  const formData = new FormData();
  formData.append('actionType', 'saveBytes');
  formData.append('path', target.path);
  formData.append('bytes', new Blob([bytes]));
  if (target.root) formData.append('root', target.root);
  if (target.repo && target.repo !== '.') formData.append('repo', target.repo);
  if (typeof options.baseMtimeMs === 'number') formData.append('baseMtime', String(options.baseMtimeMs));

  try {
    const res = await fetch('/api/fs/action', { method: 'POST', body: formData });
    const data = (await res.json().catch(() => null)) as SaveBytesResponse | null;
    if (res.status === 409) {
      return { status: 'conflict', diskMtimeMs: typeof data?.mtimeMs === 'number' ? data.mtimeMs : null };
    }
    if (res.ok && data?.success) {
      return { status: 'written', mtimeMs: typeof data.mtimeMs === 'number' ? data.mtimeMs : null };
    }
    return { status: 'failed', error: typeof data?.error === 'string' ? data.error : null };
  } catch {
    return { status: 'failed', error: null };
  }
}
