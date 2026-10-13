/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A stand-in for the Files panel's clipboard, for specs that exercise a ROW
 * rather than the panel (`useFileActions`).
 *
 * The real hook is owned by the panel and passed down, so a row spec has no
 * panel to build it. This records what a row asked for and answers the refusal
 * it was configured with — which is all a row's menu reads: the entry (for the
 * Paste label) and `refusalFor` (whether Paste exists at all).
 */

import type { ClipboardTarget, FileClipboard } from '@/client/hooks/workspace/file-clipboard';
import type { FsClipboard } from '@/shared/lib/fs/clipboard';

export interface StubClipboardOptions {
  /** What Cut/Copy put aside, as the row spec's starting state. */
  clip?: FsClipboard | null;
  /** The reason `refusalFor` answers with, or null to allow every paste. */
  refusal?: string | null;
  /** The reason `moveRefusalFor` answers with; falls back to `refusal`. */
  moveRefusal?: string | null;
  busy?: boolean;
}

export interface StubClipboard extends FileClipboard {
  /** Every call the row made, in order. */
  calls: Array<{ action: string; target: ClipboardTarget }>;
}

export function createStubClipboard(options: StubClipboardOptions = {}): StubClipboard {
  const calls: StubClipboard['calls'] = [];
  const clip = options.clip ?? null;
  const record = (action: string) => (target: ClipboardTarget) => {
    calls.push({ action, target });
  };
  return {
    clip,
    busy: options.busy ?? false,
    calls,
    refusalFor: () => options.refusal ?? null,
    moveRefusalFor: () => options.moveRefusal ?? options.refusal ?? null,
    copy: record('copy'),
    cut: record('cut'),
    duplicate: record('duplicate'),
    paste: record('paste'),
    move: record('move'),
  };
}
