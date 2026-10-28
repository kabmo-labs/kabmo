/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone editor's status strip: what the buffer holds on the left, what the
 * last write did on the right.
 *
 * Extracted from `FullEditor` for the repository's per-file ceiling, and it
 * earns the boundary: the strip is the one part of that surface that reads no
 * editor behaviour, only the three facts it prints.
 *
 * A byte viewer prints its KIND instead of counts. Its buffer is empty by
 * design, so `1 lines · 0 chars` described a PDF that was drawing fine — the
 * empty buffer's statistics presented as measurements of the document.
 */

import { Loader2 } from 'lucide-preact';
import { VIEWER_LABELS, type ViewerKind } from '@/shared/lib/fs/document-kind';
import type { FileEditorSaveStatus } from '@/client/hooks/editor/use-file-editor';

interface EditorStatusBarProps {
  isImage: boolean;
  byteViewer: boolean;
  viewerKind: ViewerKind;
  lineCount: number;
  charCount: number;
  language: string;
  saveStatus: FileEditorSaveStatus;
  path?: string;
  /** Merge-conflict blocks in the buffer, or 0 (see the desktop strip). */
  conflicts?: number;
}

export function EditorStatusBar({
  isImage,
  byteViewer,
  viewerKind,
  lineCount,
  charCount,
  language,
  saveStatus,
  path,
  conflicts = 0,
}: EditorStatusBarProps) {
  return (
    <footer
      className="bg-canvas border-t border-ink/10 px-3 flex items-center justify-between text-[10px] text-ink/60 flex-shrink-0 font-mono"
      style={{
        height: 'calc(1.75rem + env(safe-area-inset-bottom, 0px))',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      }}
    >
      <div className="flex items-center space-x-3">
        {isImage ? (
          <span className="uppercase">Image</span>
        ) : byteViewer ? (
          <span className="uppercase">{VIEWER_LABELS[viewerKind]}</span>
        ) : (
          <>
            {conflicts > 0 && (
              <span className="text-error font-semibold tabular-nums">
                ⚠ {conflicts}
              </span>
            )}
            <span>{lineCount} lines</span>
            <span>{charCount} chars</span>
            <span className="uppercase">{language}</span>
          </>
        )}
      </div>
      <div className="flex items-center space-x-2">
        {saveStatus === 'saving' && (
          <>
            <Loader2 size={10} className="animate-spin" />
            <span>Saving…</span>
          </>
        )}
        {saveStatus === 'saved' && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-success"></span>
            <span>Saved</span>
          </>
        )}
        {saveStatus === 'error' && (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-error"></span>
            <span className="text-error">Save failed</span>
          </>
        )}
        {saveStatus === 'idle' && path && <span className="truncate max-w-[140px]">{path}</span>}
      </div>
    </footer>
  );
}
