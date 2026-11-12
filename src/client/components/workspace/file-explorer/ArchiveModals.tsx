/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two archive dialogs: Compress to… and Extract…
 *
 * Both portal to `<body>` (the composer's backdrop-filter trap lives elsewhere,
 * but the rule is the same: a `fixed` overlay must not be sized by an ancestor)
 * and both show the server's refusal INLINE, because the field that caused it
 * is still on screen. The format list is the server's availability answer;
 * a format whose binary is missing is listed disabled with the reason, so the
 * user sees the machine's limit instead of a failure after submitting.
 */

import { createPortal } from 'preact/compat';
import type { FormEvent } from 'preact/compat';
import { archiveKindLabel, archiveKindOf, type ArchiveFormat } from '@/shared/lib/fs/archive';
import type { ClipboardTarget } from '@/client/hooks/workspace/file-clipboard';
import type { FileArchive } from '@/client/hooks/workspace/file-archive';

export interface ArchiveFormatOption {
  id: ArchiveFormat;
  label: string;
  extension: string;
  available: boolean;
  tool: string;
}

interface ShellProps {
  title: string;
  /** What is being acted on, one line. */
  subject: string;
  error: string | null;
  busy: boolean;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
  children: preact.ComponentChildren;
}

function ArchiveDialogShell({ title, subject, error, busy, submitLabel, busyLabel, onSubmit, onCancel, children }: ShellProps) {
  return createPortal(
    <div className="fixed inset-0 modal-scrim z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="glass-overlay bg-paper rounded shadow-xl p-4 w-full max-w-sm border border-ink/10 font-sans">
        <h3 className="font-semibold text-ink mb-1 text-sm">{title}</h3>
        <p className="text-[11px] text-ink/50 mb-3 break-words">{subject}</p>
        {children}
        {error && <p className="text-[11px] text-error mb-2">{error}</p>}
        <div className="flex justify-end space-x-2 mt-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-ink hover:bg-ink/5 rounded transition-colors"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs bg-ink text-canvas rounded hover:bg-ink/90 transition-colors flex items-center"
            disabled={busy}
          >
            {busy ? busyLabel : submitLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

export interface CompressDialogProps {
  entries: readonly ClipboardTarget[];
  format: ArchiveFormat;
  name: string;
  destination: string;
  formats: readonly ArchiveFormatOption[];
  error: string | null;
  busy: boolean;
  onFormatChange: (format: ArchiveFormat) => void;
  onNameChange: (name: string) => void;
  onDestinationChange: (destination: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function CompressDialog({
  entries,
  format,
  name,
  destination,
  formats,
  error,
  busy,
  onFormatChange,
  onNameChange,
  onDestinationChange,
  onCancel,
  onSubmit,
}: CompressDialogProps) {
  const names = entries.slice(0, 4).map((entry) => entry.name).join(', ');
  const more = entries.length > 4 ? ` +${entries.length - 4} more` : '';
  return (
    <ArchiveDialogShell
      title={`Compress ${entries.length === 1 ? entries[0]!.name : `${entries.length} items`}`}
      subject={`${names}${more}`}
      error={error}
      busy={busy}
      submitLabel="Compress"
      busyLabel="Compressing..."
      onCancel={onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="block text-[10px] uppercase tracking-wide text-ink/40 mb-1" htmlFor="archive-format">
        Format
      </label>
      <select
        id="archive-format"
        value={format}
        onChange={(event) => onFormatChange(event.currentTarget.value as ArchiveFormat)}
        className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-ink mb-3"
      >
        {formats.map((option) => (
          <option key={option.id} value={option.id} disabled={!option.available}>
            {option.label}
            {option.available ? '' : ` — ${option.tool} not installed`}
          </option>
        ))}
      </select>

      <label className="block text-[10px] uppercase tracking-wide text-ink/40 mb-1" htmlFor="archive-name">
        Archive name
      </label>
      <input
        id="archive-name"
        autoFocus
        type="text"
        value={name}
        onChange={(event) => onNameChange(event.currentTarget.value)}
        aria-label="Archive name"
        className={`w-full bg-paper border rounded px-2 py-1.5 text-xs font-mono focus:outline-none mb-3 ${
          error ? 'border-error' : 'border-ink/20 focus:border-ink'
        }`}
      />

      <label className="block text-[10px] uppercase tracking-wide text-ink/40 mb-1" htmlFor="archive-destination">
        Destination folder
      </label>
      <input
        id="archive-destination"
        type="text"
        value={destination}
        onChange={(event) => onDestinationChange(event.currentTarget.value)}
        aria-label="Archive destination"
        className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-ink"
      />
    </ArchiveDialogShell>
  );
}

export interface ExtractDialogProps {
  archive: ClipboardTarget;
  /** The detected archive kind, shown so the user knows what will unpack. */
  kindLabel: string;
  destination: string;
  error: string | null;
  busy: boolean;
  onDestinationChange: (destination: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}

export function ExtractDialog({
  archive,
  kindLabel,
  destination,
  error,
  busy,
  onDestinationChange,
  onCancel,
  onSubmit,
}: ExtractDialogProps) {
  return (
    <ArchiveDialogShell
      title={`Extract ${archive.name}`}
      subject={`${kindLabel} archive · extracts into a folder`}
      error={error}
      busy={busy}
      submitLabel="Extract"
      busyLabel="Extracting..."
      onCancel={onCancel}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label className="block text-[10px] uppercase tracking-wide text-ink/40 mb-1" htmlFor="extract-destination">
        Extract to folder
      </label>
      <input
        id="extract-destination"
        autoFocus
        type="text"
        value={destination}
        onChange={(event) => onDestinationChange(event.currentTarget.value)}
        aria-label="Extract destination"
        className={`w-full bg-paper border rounded px-2 py-1.5 text-xs font-mono focus:outline-none ${
          error ? 'border-error' : 'border-ink/20 focus:border-ink'
        }`}
      />
    </ArchiveDialogShell>
  );
}

/**
 * Both archive dialogs, driven by the panel's one `useFileArchive` handle.
 *
 * The panel renders this once, beside the tree: the draft, the format list and
 * the busy flag all live in the hook, so the overlay is a pure projection and
 * the panel does not grow two 20-line prop blocks.
 */
export function ArchiveOverlays({ archive }: { archive: FileArchive }) {
  if (archive.compress) {
    return (
      <CompressDialog
        entries={archive.compress.entries}
        format={archive.compress.format}
        name={archive.compress.name}
        destination={archive.compress.destination}
        formats={archive.formats}
        error={archive.error}
        busy={archive.busy}
        onFormatChange={archive.setFormat}
        onNameChange={archive.setName}
        onDestinationChange={archive.setCompressDestination}
        onCancel={archive.cancel}
        onSubmit={archive.submitCompress}
      />
    );
  }
  if (archive.extract) {
    return (
      <ExtractDialog
        archive={archive.extract.archive}
        kindLabel={archiveKindLabel(archiveKindOf(archive.extract.archive.name) ?? 'zip')}
        destination={archive.extract.destination}
        error={archive.error}
        busy={archive.busy}
        onDestinationChange={archive.setExtractDestination}
        onCancel={archive.cancel}
        onSubmit={archive.submitExtract}
      />
    );
  }
  return null;
}
