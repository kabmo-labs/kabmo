/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's "this file was deleted from disk" strip.
 *
 * Extracted from `FullEditor` for the per-file ceiling. It is a banner rather
 * than a dialog because the buffer is still on screen and still editable: the
 * user has to be able to see, and act on, the file they are editing while the
 * fact sits above it. The desktop pane says the same thing in the same words —
 * the two layouts are one product.
 */

import { AlertTriangle } from 'lucide-preact';

export function MissingFileBanner() {
  return (
    <div className="flex items-start gap-2 px-3 py-2 border-b border-error/30 bg-error/10 text-error shrink-0">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-[11.5px] font-sans">This file was deleted from disk.</div>
        <div className="text-[11px] font-sans text-error/80">
          The buffer is still here. Saving recreates the file — autosave is off until then.
        </div>
      </div>
    </div>
  );
}
