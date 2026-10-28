/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The refusal a document viewer draws when its parser could not read the file.
 *
 * One component for every viewer, because the failure is the same fact each
 * time — the bytes arrived and the parser rejected them — and a per-viewer
 * sentence is how the same failure gets worded four ways. The parser's own
 * message is shown verbatim: it names what was wrong (an encrypted PDF, a file
 * that is not really an `.xlsx`), which is the part a generic "could not open"
 * throws away.
 */

import { AlertTriangle } from 'lucide-preact';

interface ViewerErrorProps {
  name: string;
  message: string;
}

export function ViewerError({ name, message }: ViewerErrorProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertTriangle size={20} className="text-error" />
      <span className="font-sans text-xs text-error">Could not show {name}</span>
      <span className="max-w-[42ch] break-words font-mono text-[11px] text-ink/50">{message}</span>
    </div>
  );
}
