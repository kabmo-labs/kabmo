import { useState } from 'preact/hooks';
import { Activity, AlertCircle, Check } from 'lucide-preact';
import type { McpServerItem, McpTransport } from '@/shared/types';

/** Shape of the response returned by POST /api/settings/mcp-test. */
interface McpTestResult {
  ok: boolean;
  transport: McpTransport;
  protocolVersion?: string;
  serverInfo?: { name?: string; version?: string };
  toolCount?: number;
  durationMs: number;
  error?: string;
}

interface ConnectionTestProps {
  server: McpServerItem;
}

/** "Test Connection" button + inline result for the MCP detail pane. Runs a
 * real handshake against the current form values and renders the outcome. */
export function ConnectionTest({ server }: ConnectionTestProps) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<McpTestResult | null>(null);

  const runTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const response = await fetch('/api/settings/mcp-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server }),
      });
      const data = (await response.json()) as McpTestResult;
      setResult(data);
    } catch (error) {
      setResult({
        ok: false,
        transport: server.transport,
        durationMs: 0,
        error: error instanceof Error ? error.message : 'Request failed',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="flex items-center gap-2 min-w-0">
      <button
        type="button"
        onClick={runTest}
        disabled={testing}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-ink/20 hover:border-ink/40 text-xs font-medium text-ink hover:bg-ink/5 transition-colors disabled:opacity-50 cursor-pointer"
      >
        <Activity className={`w-3.5 h-3.5 ${testing ? 'animate-spin' : ''}`} />
        {testing ? 'Testing...' : 'Test Connection'}
      </button>

      {result && !testing && (
        result.ok ? (
          <span className="flex items-center gap-1.5 text-xs text-ink font-medium min-w-0">
            <Check className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">
              {result.serverInfo?.name ?? server.name}
              {result.serverInfo?.version ? ` v${result.serverInfo.version}` : ''}
            </span>
            {result.protocolVersion && (
              <span className="text-ink/50 shrink-0">· {result.protocolVersion}</span>
            )}
            {typeof result.toolCount === 'number' && (
              <span className="text-ink/50 shrink-0">· {result.toolCount} tools</span>
            )}
            <span className="text-ink/50 shrink-0">· {result.durationMs}ms</span>
          </span>
        ) : (
          <span
            className="flex items-center gap-1 text-xs text-error font-medium min-w-0"
            title={result.error ?? 'Connection failed'}
          >
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[280px]">{result.error ?? 'Connection failed'}</span>
          </span>
        )
      )}
    </div>
  );
}
