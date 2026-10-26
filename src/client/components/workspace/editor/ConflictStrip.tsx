/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The write-conflict strip: "this file changed on disk".
 *
 * A save refused with `409` is not a failure — the buffer is intact and the disk
 * holds someone else's bytes — so the panel cannot report it as one. It offers the
 * two answers that actually exist:
 *
 * - **Reload** takes the disk copy and discards the buffer's edits.
 * - **Keep mine** writes the buffer over it, adopting the disk mtime as the new
 *   base so the same refusal cannot come straight back.
 *
 * The strip sits above the document rather than in a modal: the user has to see
 * what they are choosing between, and a modal over the editor hides it. It is
 * also the reason the toolbar's save status stays `idle` on a conflict — two
 * indicators for one event would disagree about whether the file was written.
 */

import { AlertTriangle } from 'lucide-preact';

interface ConflictStripProps {
  /** The mtime the disk holds now, or null when the refusal named none. */
  diskMtimeMs: number | null;
  fileName: string;
  onReload: () => void;
  onKeepMine: () => void;
}

/** `14:32:07` — the disk copy's own clock, so the two sides are comparable. */
function formatTime(mtimeMs: number | null): string | null {
  if (mtimeMs === null) return null;
  const date = new Date(mtimeMs);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function ConflictStrip({ diskMtimeMs, fileName, onReload, onKeepMine }: ConflictStripProps) {
  const at = formatTime(diskMtimeMs);
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 border-b border-warning/30 bg-warning/10 text-[11px] text-ink flex-shrink-0"
      role="alert"
      data-conflict-strip=""
    >
      <AlertTriangle size={13} className="text-warning flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <span className="font-mono">{fileName}</span> changed on disk
          {at ? <span className="text-ink/60"> at {at}</span> : null}.
        </div>
        <div className="text-ink/60 mt-0.5">Your save was refused so nothing was overwritten.</div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onReload}
          className="px-2 py-1 rounded border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
          title="Discard my changes and take the file from disk"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          className="px-2 py-1 rounded border border-warning/50 text-warning hover:bg-warning/10 transition-colors cursor-pointer"
          title="Write my buffer over the file on disk"
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}
