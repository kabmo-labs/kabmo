/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import type { FileEditorTarget } from '@/client/hooks/editor/file-editor-types';

/**
 * The key a target's buffer is cached under.
 *
 * One rule for every hook that caches by file: the read path, the write path, the
 * conflict machine and the disk watcher all have to agree, or a reload clears a
 * key the read never wrote.
 */
export function editorTargetKey(target: Pick<FileEditorTarget, 'id' | 'path' | 'name'>): string {
  return String(target.id ?? target.path ?? target.name);
}
