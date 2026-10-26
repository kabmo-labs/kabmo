/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The Save As dialog.
 *
 * Two fields, because a destination is two facts: which DIRECTORY, and what NAME. The
 * directory is workspace-relative — the editor only ever deals in paths relative to the
 * scope it was opened in, and an absolute path would be a value the server has to refuse
 * (`resolveWithinRoot` is the boundary). The name starts as `<file> copy.<ext>` rather than
 * `copy` alone: a destination that lost its extension would be saved as a file the surface
 * no longer recognises, so the language would change under the user.
 *
 * ## A refusal keeps the dialog open, with the name still in it
 *
 * An existing destination is the common refusal and it is not a failure — the user picked a
 * name that is taken. Closing the dialog on a `409` would read as success and leave them
 * wondering where the file went, so the refusal is shown inline and the field stays.
 *
 * ## What Save As does NOT do
 *
 * The original file is untouched and the ORIGINAL tab stays open. The new file gets its own
 * tab, which is what makes the operation reversible by closing one tab — and what makes it
 * different from a rename (which is the Files panel's job).
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import { CornerDownLeft, Loader2 } from 'lucide-preact';

import { Modal } from '@/client/components/common/Modal';
import {
  isSingleSegmentName,
  saveAsSuggestedName,
  saveFileAs,
  type SaveAsOutcome,
} from '@/client/hooks/editor/save-as';

interface SaveAsModalProps {
  /** The open file: its name seeds the field, its path seeds the directory. */
  fileName: string;
  /** Workspace-relative path of the source, so the directory starts where it lives. */
  filePath: string;
  /** The buffer, LF-only. */
  content: string;
  eol: 'lf' | 'crlf';
  root?: string;
  repo?: string;
  onSaved: (outcome: { path: string }) => void;
  onClose: () => void;
}

/** The directory part of a workspace-relative path, or `''` at the root. */
export function directoryOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? '' : path.slice(0, cut);
}

export function SaveAsModal({
  fileName,
  filePath,
  content,
  eol,
  root,
  repo,
  onSaved,
  onClose,
}: SaveAsModalProps) {
  const [directory, setDirectory] = useState(() => directoryOf(filePath));
  const [name, setName] = useState(() => saveAsSuggestedName(fileName));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
    // Select the stem so typing replaces it — the suggested name is a starting point,
    // and a user who types immediately means to replace it, not append to it.
    nameRef.current?.select();
  }, []);

  const valid = isSingleSegmentName(name);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setRefusal(null);
    const outcome: SaveAsOutcome = await saveFileAs({ parent: directory, name, content, eol, root, repo });
    setBusy(false);
    if (outcome.status === 'written') {
      onSaved({ path: outcome.path });
      return;
    }
    // Both refusals keep the dialog open with the field intact: the user picked a name
    // that cannot be used, and closing would read as success.
    setRefusal(outcome.reason);
  };

  const onKeyDown = (event: TargetedKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void submit();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-md"
      header={<span className="text-sm font-semibold text-ink">Save as</span>}
      footer={
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-ink/10">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded border border-ink/20 text-ink/80 hover:bg-ink/5 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-ink text-paper disabled:opacity-40 disabled:cursor-default cursor-pointer"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <CornerDownLeft size={12} />}
            Save
          </button>
        </div>
      }
    >
      <div className="px-4 py-3 space-y-2 text-xs">
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-ink/50 mb-1">Folder</span>
          <input
            value={directory}
            onInput={(event) => setDirectory((event.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            placeholder="(workspace root)"
            aria-label="Destination folder"
            className="w-full bg-paper border border-ink/20 rounded px-2 py-1 font-mono text-ink outline-none focus:border-ink/40"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] uppercase tracking-wide text-ink/50 mb-1">Name</span>
          <input
            ref={nameRef}
            value={name}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
            onKeyDown={onKeyDown}
            aria-label="File name"
            aria-invalid={!valid}
            className={`w-full bg-paper border rounded px-2 py-1 font-mono text-ink outline-none ${
              valid ? 'border-ink/20 focus:border-ink/40' : 'border-error text-error'
            }`}
          />
        </label>
        {!valid ? (
          <div className="text-[10px] text-error font-mono">Enter a file name without a path separator</div>
        ) : null}
        {refusal ? <div className="text-[10px] text-error font-mono">{refusal}</div> : null}
        <div className="text-[10px] text-ink/40">
          The original file stays where it is, and its tab stays open.
        </div>
      </div>
    </Modal>
  );
}
