import { createPortal } from 'preact/compat';
import type { FormEvent } from 'preact/compat';
import { History, RefreshCw, X } from 'lucide-preact';
import type { FsActionResponse } from '@/shared/types';

interface NewFileModalProps {
  /** Folder the file will be created in, relative to the listed root. */
  folderPath: string;
  value: string;
  /** Server's refusal (a name that already exists, a bad character), shown inline. */
  error?: string | null;
  isLoading: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (e: FormEvent) => void;
}

/**
 * The "New File" dialog.
 *
 * Only a name is asked for — the folder is the one that was right-clicked, and
 * showing it as a fixed prefix is what makes the field's meaning unambiguous.
 * The input starts empty (no `.txt` default): a name is what the user has in
 * mind, and a prefilled suffix is a character to delete before every keystroke
 * lands. The server's refusal is rendered INLINE rather than as a toast: the
 * field is still open, and "already exists" is a message about what to type
 * next, not a notification about something that happened.
 */
export function FileCreateModal({ folderPath, value, error, isLoading, onChange, onCancel, onSubmit }: NewFileModalProps) {
  return createPortal(
    <div className="fixed inset-0 bg-ink/20 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="bg-paper rounded shadow-xl p-4 w-full max-w-sm border border-ink/10 font-sans">
        <h3 className="font-semibold text-ink mb-3 text-sm">New File</h3>
        <div className="flex items-center gap-1 mb-1 text-xs font-mono text-ink/50 min-w-0">
          <span className="truncate" title={folderPath}>{folderPath || '.'}/</span>
        </div>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={e => onChange(e.currentTarget.value)}
          placeholder="file name"
          aria-label="New file name"
          className={`w-full bg-paper border rounded px-2 py-1.5 text-xs font-mono focus:outline-none mb-2 ${
            error ? 'border-error' : 'border-ink/20 focus:border-ink'
          }`}
        />
        {error && <p className="text-[11px] text-error mb-2">{error}</p>}
        <div className="flex justify-end space-x-2 mt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-ink hover:bg-ink/5 rounded transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs bg-ink text-canvas rounded hover:bg-ink/90 transition-colors flex items-center"
            disabled={isLoading || !value.trim()}
          >
            {isLoading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

interface DeleteModalProps {
  fileName: string;
  isFolder: boolean;
  isLoading: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function FileDeleteModal({ fileName, isFolder, isLoading, onCancel, onConfirm }: DeleteModalProps) {
  return createPortal(
    <div className="fixed inset-0 bg-ink/20 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-paper rounded shadow-xl p-4 w-full max-w-sm border border-ink/10 font-sans">
        <h3 className="font-semibold text-ink mb-2 text-sm">Delete {isFolder ? 'Folder' : 'File'}</h3>
        <p className="text-xs text-ink/70 mb-4">Are you sure you want to delete <span className="font-mono bg-canvas px-1 rounded">{fileName}</span>? This action cannot be undone.</p>
        <div className="flex justify-end space-x-2">
          <button 
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-ink hover:bg-ink/5 rounded transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button 
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs bg-error text-white rounded hover:bg-error/90 transition-colors flex items-center"
            disabled={isLoading}
          >
            {isLoading ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

interface RenameModalProps {
  isFolder: boolean;
  renameValue: string;
  originalPath: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (e: FormEvent) => void;
}

export function FileRenameModal({ isFolder, renameValue, originalPath, isLoading, onChange, onCancel, onSubmit }: RenameModalProps) {
  return createPortal(
    <div className="fixed inset-0 bg-ink/20 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <form onSubmit={onSubmit} className="bg-paper rounded shadow-xl p-4 w-full max-w-sm border border-ink/10 font-sans">
        <h3 className="font-semibold text-ink mb-3 text-sm">Rename {isFolder ? 'Folder' : 'File'}</h3>
        <input 
          autoFocus
          type="text" 
          value={renameValue}
          onChange={e => onChange(e.currentTarget.value)}
          className="w-full bg-paper border border-ink/20 rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-ink mb-4"
        />
        <div className="flex justify-end space-x-2">
          <button 
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-xs text-ink hover:bg-ink/5 rounded transition-colors"
            disabled={isLoading}
          >
            Cancel
          </button>
          <button 
            type="submit"
            className="px-3 py-1.5 text-xs bg-ink text-canvas rounded hover:bg-ink/90 transition-colors flex items-center"
            disabled={isLoading || !renameValue.trim() || renameValue === originalPath}
          >
            {isLoading ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

interface HistoryModalProps {
  filePath: string;
  fetcherState: string;
  fetcherData: FsActionResponse | undefined;
  onClose: () => void;
}

export function FileHistoryModal({ filePath, fetcherState, fetcherData, onClose }: HistoryModalProps) {
  const rows = fetcherData?.type === 'history' ? fetcherData.data : undefined;
  return createPortal(
    <div className="fixed inset-0 bg-ink/20 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-paper rounded-lg shadow-xl w-full max-w-4xl border border-ink/10 flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between p-4 border-b border-ink/10">
          <h3 className="text-sm font-semibold text-ink flex items-center space-x-2">
            <History size={16} className="text-ink/60" />
            <span>Git History: <span className="font-mono font-normal opacity-80">{filePath}</span></span>
          </h3>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-ink/5 rounded text-ink/60 transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        
        <div className="flex-1 scrollbar-overlay-container scrollbar-overlay-static bg-paper p-2">
          {fetcherState === 'idle' ? (
            rows ? (
              rows.length > 0 ? (
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead className="bg-canvas sticky top-0 z-10 border-b border-ink/10">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-ink/70 rounded-tl">Description</th>
                      <th className="px-3 py-2 font-semibold text-ink/70 w-32">Date</th>
                      <th className="px-3 py-2 font-semibold text-ink/70 w-32">Author</th>
                      <th className="px-3 py-2 font-semibold text-ink/70 w-24 text-right rounded-tr">Commit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/5">
                    {rows.map((row, i) => (
                      <tr key={i} className="hover:bg-ink/[0.03] transition-colors group bg-paper">
                        <td className="px-3 py-2 text-ink">
                          {row.message ? <span className="font-medium text-ink/90 group-hover:text-ink">{row.message}</span> : null}
                        </td>
                        <td className="px-3 py-2 text-ink/60 whitespace-nowrap font-mono text-[10.5px]">
                          {row.time}
                        </td>
                        <td className="px-3 py-2 text-ink/70 whitespace-nowrap truncate max-w-[120px]">
                          {row.author}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {row.hash ? <span className="font-mono text-ink/50 group-hover:text-ink font-semibold transition-colors bg-canvas px-1.5 py-0.5 rounded border border-ink/10">{row.hash}</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="p-8 text-center text-ink/40 font-mono text-xs">No commit history found for this file.</div>
              )
            ) : fetcherData?.error ? (
              <div className="p-8 text-center text-error font-mono text-xs">{fetcherData.error}</div>
            ) : (
              <div className="p-8 text-center text-ink/40 font-mono text-xs">Loading history...</div>
            )
          ) : (
            <div className="p-8 text-center text-ink/40 font-mono text-xs flex items-center justify-center space-x-2">
              <RefreshCw size={14} className="animate-spin" />
              <span>Loading history...</span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
