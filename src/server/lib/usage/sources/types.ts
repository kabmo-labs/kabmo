/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One store the Token Usage index folds.
 *
 * omp writes an append-only JSONL transcript, so its source keeps a byte offset
 * and reads only the tail. The ACP harnesses keep SQLite files, zstd JSONL and
 * monthly usage logs instead: those are replaced whole when they change, because
 * a row can be updated in place and a tail read would miss it.
 */

import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { UsageRollupRow } from '@/server/lib/usage/index-parse';

/** One transcript/source file, as listed by a source. */
export interface UsageSourceFile {
  /** Unique store-qualified key stored in `usage_index_file.session_file`. */
  key: string;
  harness: HarnessId;
  /** Project label the rows are attributed to, overridable by `read`. */
  project: string;
  size: number;
  mtimeMs: number;
}

/** A row in `usage_index_file`: how far one source file has been folded. */
export interface UsageFileState {
  session_file: string;
  source: string;
  harness: string;
  offset: number;
  size: number;
  mtime_ms: number;
}

/** What folding one file produced. */
export interface UsageSourceRead {
  rows: Map<string, UsageRollupRow>;
  nextOffset: number;
  /** True only for a tail read; a full read replaces the file's rows. */
  append: boolean;
}

/** One readable store. `list` returns [] when the store does not exist. */
export interface UsageSource {
  id: string;
  list(): Promise<UsageSourceFile[]>;
  /** `null` means "unreadable; keep the rows already indexed". */
  read(file: UsageSourceFile, previous: UsageFileState | null): Promise<UsageSourceRead | null>;
}
