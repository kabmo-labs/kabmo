import { useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import { AlertCircle, Code, Loader2, X } from 'lucide-preact';
import type { McpServerItem, WriteOutcome } from '@/shared/types';
import { parseMcpImport } from '@/shared/lib/mcp/import';

interface McpImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves with the save's outcome; a refusal keeps this dialog open. */
  onImport: (servers: McpServerItem[]) => Promise<WriteOutcome>;
}

const SAMPLE_JSON = `{
  "mcpServers": {
    "postgres-db": {
      "command": "bunx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://user:pass@localhost:5432/db"],
      "env": {
        "DEBUG": "1"
      }
    }
  }
}`;

export const McpImportModal: FunctionComponent<McpImportModalProps> = ({
  isOpen,
  onClose,
  onImport,
}) => {
  const [jsonText, setJsonText] = useState(SAMPLE_JSON);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  if (!isOpen) return null;

  const handleParseAndImport = async () => {
    setError(null);
    let servers: McpServerItem[];
    try {
      servers = parseMcpImport(jsonText);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid JSON format');
      return;
    }

    // The dialog closes on the SAVE's answer, not on the click: a refused
    // write has to be readable against the JSON that produced it.
    setImporting(true);
    try {
      const outcome = await onImport(servers);
      if (outcome.ok) onClose();
      else setError(outcome.error ?? 'The server refused the import.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 modal-scrim backdrop-blur-[2px] z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="glass-overlay w-full max-w-lg rounded-lg border border-ink/20 bg-paper text-ink p-5 shadow-2xl space-y-4 max-h-full overflow-y-auto scrollbar-overlay-container">
        <div className="flex items-center justify-between pb-3 border-b border-ink/10">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-ink/70" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
              Import MCP Servers from JSON
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-ink/70 leading-relaxed">
          Paste a configuration block from omp, Claude, VS Code, Cursor, Gemini, or OpenCode.
          Every server in the snippet is imported.
        </p>

        <textarea
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.currentTarget.value);
            setError(null);
          }}
          rows={10}
          className="w-full text-xs font-mono p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink resize-none leading-relaxed text-ink transition-colors"
          placeholder="Paste JSON snippet here..."
        />

        {error && (
          <div className="flex items-center gap-2 text-xs text-error p-2.5 rounded-lg bg-error/10 border border-error/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span className="font-medium">{error}</span>
          </div>
        )}

        <div className="pt-3 border-t border-ink/10 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink/80 hover:text-ink transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleParseAndImport()}
            disabled={importing}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer disabled:opacity-50 disabled:cursor-progress"
          >
            {importing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {importing ? 'Importing…' : 'Import Servers'}
          </button>
        </div>
      </div>
    </div>
  );
};
