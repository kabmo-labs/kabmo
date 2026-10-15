import { useState } from 'preact/hooks';
import type { FunctionComponent } from 'preact/compat';
import { AlertCircle, Code, X } from 'lucide-preact';
import type { McpEnvVar, McpServerItem } from '@/shared/types';

interface McpImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (server: McpServerItem) => void;
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

  if (!isOpen) return null;

  const handleParseAndImport = () => {
    setError(null);
    try {
      const parsed = JSON.parse(jsonText);

      // Handle {"mcpServers": { "name": { ... } }} format
      if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
        const serverKeys = Object.keys(parsed.mcpServers);
        if (serverKeys.length === 0) {
          throw new Error('No servers found inside "mcpServers" object.');
        }
        const firstKey = serverKeys[0];
        const serverConfig = parsed.mcpServers[firstKey];
        importConfig(firstKey, serverConfig);
        return;
      }

      // Handle direct config: { name, command, args, env } or { command, args }
      const name = parsed.name || 'imported-mcp-server';
      importConfig(name, parsed);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid JSON format';
      setError(message);
    }
  };

  const importConfig = (serverName: string, cfg: Record<string, unknown>) => {
    const isUrl = typeof cfg.url === 'string' && cfg.url.length > 0;
    const reachType = isUrl ? 'link' : 'command';

    let commandArgs: string[] = [];
    if (!isUrl) {
      const cmd = typeof cfg.command === 'string' ? [cfg.command] : [];
      const args = Array.isArray(cfg.args) ? cfg.args.map(String) : [];
      commandArgs = [...cmd, ...args];
      if (commandArgs.length === 0) {
        commandArgs = ['bunx', '@modelcontextprotocol/server-everything'];
      }
    }

    const envVars: McpEnvVar[] = [];
    if (cfg.env && typeof cfg.env === 'object') {
      Object.entries(cfg.env).forEach(([k, v], idx) => {
        envVars.push({
          id: `env-${Date.now()}-${idx}`,
          key: k,
          value: String(v),
        });
      });
    }

    const newServer: McpServerItem = {
      id: `mcp-${Date.now()}`,
      name: serverName,
      scope: 'every-project',
      enabled: true,
      reachType,
      commandArgs,
      linkUrl: isUrl ? (cfg.url as string) : undefined,
      envVars,
      status: 'active',
    };

    onImport(newServer);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] z-50 flex items-center justify-center p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg rounded-lg border border-ink/20 bg-paper text-ink p-5 shadow-2xl space-y-4 max-h-full overflow-y-auto scrollbar-overlay-container">
        <div className="flex items-center justify-between pb-3 border-b border-ink/10">
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-ink/70" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
              Import MCP Server from JSON
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
          Paste a configuration block from Claude Desktop, VS Code, or Cursor settings.
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
            onClick={handleParseAndImport}
            className="px-4 py-2 rounded-lg bg-ink text-paper text-xs font-medium hover:bg-ink/90 transition-colors shadow-xs cursor-pointer"
          >
            Import Server
          </button>
        </div>
      </div>
    </div>
  );
};
