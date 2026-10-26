/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The external-change strip: "this file changed on disk while you were editing".
 *
 * Distinct from `ConflictStrip` on purpose, and the difference is what the user can
 * do. A CONFLICT is a save the server refused — the buffer is still ahead and the
 * choice is which side wins. This is the earlier warning: the disk moved and the
 * buffer has NOT been written, so the choice is "take theirs now" or "keep editing
 * mine". Both offer Reload/Keep, and neither is a modal: the user has to see the
 * file they are choosing about.
 */

import { RefreshCw } from 'lucide-preact';

interface ExternalChangeStripProps {
  fileName: string;
  onReload: () => void;
  onKeepMine: () => void;
}

export function ExternalChangeStrip({ fileName, onReload, onKeepMine }: ExternalChangeStripProps) {
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 border-b border-info/30 bg-info/10 text-[11px] text-ink flex-shrink-0"
      role="status"
      data-external-change-strip=""
    >
      <RefreshCw size={13} className="text-info flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          <span className="font-mono">{fileName}</span> changed on disk.
        </div>
        <div className="text-ink/60 mt-0.5">
          Reload takes the disk copy and discards your edits. Keep mine writes yours over it.
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onReload}
          className="px-2 py-1 rounded border border-ink/20 hover:bg-ink/5 transition-colors cursor-pointer"
          title="Take the file from disk"
        >
          Reload
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          className="px-2 py-1 rounded border border-info/50 text-info hover:bg-info/10 transition-colors cursor-pointer"
          title="Keep my buffer; the next save writes it"
        >
          Keep mine
        </button>
      </div>
    </div>
  );
}
