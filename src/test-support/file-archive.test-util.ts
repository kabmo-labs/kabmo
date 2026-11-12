/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A stand-in for the Files panel's archive dialogs, for specs that exercise a
 * ROW (`useFileActions`) rather than the panel.
 *
 * The real hook is owned by the panel; a row only needs the two openers and a
 * busy flag, and the calls it made are what the menu assertions read.
 */

import type { ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import type { FileArchive } from '@/client/hooks/workspace/file-archive';

export interface StubArchive extends FileArchive {
  /** Every dialog a row asked the panel to open, in order. */
  calls: Array<{ action: 'compress' | 'extract'; targets: ClipboardTarget[] }>;
}

export function createStubArchive(): StubArchive {
  const calls: StubArchive['calls'] = [];
  return {
    formats: [],
    compress: null,
    extract: null,
    error: null,
    busy: false,
    calls,
    openCompress: (targets) => calls.push({ action: 'compress', targets: [...targets] }),
    openExtract: (target) => calls.push({ action: 'extract', targets: [target] }),
    setFormat: () => {},
    setName: () => {},
    setCompressDestination: () => {},
    setExtractDestination: () => {},
    cancel: () => {},
    submitCompress: () => {},
    submitExtract: () => {},
  };
}
