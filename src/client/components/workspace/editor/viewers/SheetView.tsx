/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A workbook (`.xlsx`, `.xlsm` or legacy `.xls`), drawn as a grid with one tab
 * per sheet.
 *
 * The reader and the writer live in `workbook.ts` (SheetJS, which is the only
 * maintained reader for the legacy BIFF format); this file is the surface: the
 * tab strip, the loading and failure states, the grid, and the save.
 *
 * **Editing is a draft, not a write.** A cell edit goes into the reader's own
 * workbook and into a draft keyed by the file, so switching tabs does not lose
 * it; Save serializes the workbook back into its container and writes the bytes
 * through the tab's own save path. The draft is dropped when the save lands, so
 * a later open re-reads the disk.
 *
 * The tab strip is drawn even for a one-sheet workbook. It is the sheet's NAME
 * — the one piece of the workbook's own structure the grid cannot show — and a
 * strip that appears only at two sheets made the first sheet look like the
 * whole file.
 *
 * **Saving is lossy in one direction, and the surface says so.** SheetJS writes
 * values, formulas and number formats; styling, charts, images and pivot tables
 * are not part of what it reads, so they do not survive a rewrite. The warning
 * is drawn while the workbook is dirty, before the user presses Save.
 */

import { Loader2 } from 'lucide-preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ByteSource } from '@/client/components/workspace/editor/viewers/bytes';
import { useByteDocument } from '@/client/components/workspace/editor/viewers/use-byte-document';
import { ViewerError } from '@/client/components/workspace/editor/viewers/ViewerError';
import { DataGrid } from '@/client/components/workspace/editor/viewers/DataGrid';
import { readWorkbook, setWorkbookCell, writeWorkbook, type LoadedWorkbook } from '@/client/components/workspace/editor/viewers/workbook';
import { draftFor, forgetDraft, rememberDraft } from '@/client/lib/editor/workbook-drafts';
import { replaceCell } from '@/shared/lib/fs/grid-edit';

interface SheetViewProps {
  source: ByteSource;
  name: string;
  /** The tab's path, which keys the draft and names the container. */
  path?: string;
  revision?: number;
  /** Write the edited bytes; absent means the workbook is read-only. */
  onSaveBytes?: (bytes: Uint8Array) => Promise<{ ok: boolean; error?: string | null }>;
  /** Tell the tab whether unsaved edits exist, so closing it can warn. */
  onDirtyChange?: (dirty: boolean) => void;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export function SheetView({ source, name, path, revision = 0, onSaveBytes, onDirtyChange }: SheetViewProps) {
  // The byte source's id is the file's identity (a raw URL or a handle id), so
  // two dropped files that happen to share a name do not share a draft.
  const key = source.id || path || name;
  const { value, loading, error } = useByteDocument(source, (bytes) => readWorkbook(bytes, name), revision);
  const [local, setLocal] = useState<LoadedWorkbook | null>(null);
  const [dirty, setDirty] = useState(() => Boolean(draftFor(key)?.dirty));
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  // A fresh read replaces this mount's copy. A draft is NOT replaced: it is the
  // user's unsaved work, and the read that just landed is the older disk copy.
  useEffect(() => {
    setLocal(null);
  }, [value]);

  useEffect(() => {
    if (saveState !== 'saved') return;
    const timer = setTimeout(() => setSaveState('idle'), 1500);
    return () => clearTimeout(timer);
  }, [saveState]);

  // The tab's dirty flag follows this viewer's, including on mount: a draft
  // that survived a tab switch is still unsaved work, and the close guard has
  // to know that even if the flag was cleared when the tab was closed.
  //
  // The callback is read through a ref so the effect keys on `dirty` alone — a
  // caller passing an inline arrow would otherwise re-report the same value on
  // every render.
  const dirtyCallbackRef = useRef(onDirtyChange);
  dirtyCallbackRef.current = onDirtyChange;
  useEffect(() => {
    dirtyCallbackRef.current?.(dirty);
  }, [dirty]);

  if (error) return <ViewerError name={name} message={error} />;
  if (loading || value === null) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink/40">
        <Loader2 size={14} className="animate-spin" />
        <span>Loading workbook…</span>
      </div>
    );
  }

  const workbook = local ?? draftFor(key)?.workbook ?? value;
  const sheet = workbook.sheets[Math.min(active, workbook.sheets.length - 1)];
  if (!sheet) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-ink/50">
        This workbook has no sheets.
      </div>
    );
  }

  const editable = onSaveBytes !== undefined;

  const applyEdit = (row: number, col: number, text: string) => {
    setWorkbookCell(workbook.book, sheet.name, row, col, text);
    const next: LoadedWorkbook = {
      ...workbook,
      sheets: workbook.sheets.map((entry, index) =>
        index === active ? { ...entry, rows: replaceCell(entry.rows, row, col, text) } : entry,
      ),
    };
    setLocal(next);
    rememberDraft(key, { workbook: next, dirty: true });
    setDirty(true);
  };

  const save = async () => {
    if (!onSaveBytes) return;
    setSaveState('saving');
    setSaveError(null);
    const outcome = await onSaveBytes(writeWorkbook(workbook.book, workbook.format));
    if (outcome.ok) {
      setSaveState('saved');
      setDirty(false);
      forgetDraft(key);
      setLocal(workbook);
    } else {
      setSaveState('failed');
      setSaveError(outcome.error ?? null);
    }
  };

  const [header = [], ...rows] = sheet.rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Sheet tabs: a workbook's own navigation. One row, scrolled sideways on
          a narrow panel rather than wrapped — a tab strip is a single line by
          definition, and wrapping it would shift the grid down per sheet count. */}
      <div
        role="tablist"
        aria-label="Sheets"
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-ink/10 bg-canvas px-2 py-1 no-scrollbar"
      >
        {workbook.sheets.map((entry, index) => (
          <button
            key={entry.name}
            type="button"
            role="tab"
            aria-selected={index === active}
            onClick={() => setActive(index)}
            className={`shrink-0 rounded px-2 py-0.5 font-sans text-[11px] transition-colors ${
              index === active ? 'bg-ink/10 text-ink' : 'text-ink/50 hover:bg-ink/5 hover:text-ink'
            }`}
          >
            {entry.name}
          </button>
        ))}
      </div>
      {dirty && (
        <div className="shrink-0 border-b border-warning/30 bg-warning/10 px-3 py-1 font-sans text-[11px] text-warning">
          {saveState === 'failed'
            ? (saveError ?? 'Could not save the workbook.')
            : 'Saving rewrites the workbook: values and formulas are kept, styling and charts are not.'}
        </div>
      )}
      {/* Keyed by sheet: a selection belongs to the sheet it was made on, and
          carrying it across a tab switch would highlight cells the user never
          picked. */}
      <DataGrid
        key={sheet.name}
        header={header}
        rows={rows}
        truncated={sheet.truncated}
        label={sheet.name}
        readOnlyNote={
          editable
            ? 'Paste is not supported — double-click a cell to edit it.'
            : 'This workbook is read-only — the viewer cannot write workbooks.'
        }
        onEditCell={editable ? (row, col, text) => applyEdit(row + 1, col, text) : undefined}
        onEditHeader={editable ? (col, text) => applyEdit(0, col, text) : undefined}
        actions={
          editable ? (
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saveState === 'saving'}
              title="Write the edited workbook back to disk"
              className={`rounded px-1.5 py-0.5 transition-colors ${
                dirty ? 'text-ink/70 hover:bg-ink/5 hover:text-ink' : 'cursor-default text-ink/25'
              } ${saveState === 'failed' ? 'text-error' : ''}`}
            >
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Save failed' : 'Save'}
            </button>
          ) : undefined
        }
      />
    </div>
  );
}
