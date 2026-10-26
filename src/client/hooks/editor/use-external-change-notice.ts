/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The external-change strip AND its "Keep mine" answer, as one call.
 *
 * They are one concern: the strip exists so the user can choose between two answers, and
 * the answer needs the mtime the probe found. Wiring them separately in the panel meant the
 * answer read `externalChange?.mtimeMs` from a value the same component held — a second
 * place for the two to disagree about which change is being answered.
 *
 * "Keep mine" ADOPTS the disk mtime and writes nothing: the buffer stays dirty and the
 * autosave owns the write. That is the difference between this and the CONFLICT strip's
 * Keep mine, which writes immediately — a conflict is a save the server refused, so the
 * user's answer is "try again with the new base".
 */

import type { DiskChange } from '@/client/hooks/editor/use-external-change';
import { useExternalChange } from '@/client/hooks/editor/use-external-change';

interface ExternalFile {
  path?: string;
  root?: string;
  repo?: string;
  isDiff?: boolean;
}

interface UseExternalChangeNoticeOptions {
  file: ExternalFile | undefined;
  /** The mtime the buffer was read at. */
  baseMtimeMs: number | null;
  dirty: boolean;
  /** Bumped whenever something may have written the tree. */
  revision: number;
  /** Take the disk mtime as this buffer's base, writing nothing. */
  adoptDiskMtime: (diskMtimeMs: number) => void;
}

export interface ExternalChangeNotice {
  externalChange: DiskChange | null;
  /** Adopt the disk mtime so the next save is not refused. */
  keepMine: () => void;
}

export function useExternalChangeNotice({
  file,
  baseMtimeMs,
  dirty,
  revision,
  adoptDiskMtime,
}: UseExternalChangeNoticeOptions): ExternalChangeNotice {
  const externalChange = useExternalChange({
    // A diff tab's path names a CHANGE, not a document: there is no file behind it to
    // compare an mtime against.
    path: file && !file.isDiff ? file.path ?? null : null,
    root: file?.root,
    repo: file?.repo,
    baseMtimeMs,
    dirty,
    revision,
  });

  const keepMine = () => {
    const mtime = externalChange?.mtimeMs;
    if (mtime != null) adoptDiskMtime(mtime);
  };

  return { externalChange, keepMine };
}
