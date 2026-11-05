import { useMemo } from 'preact/hooks';
import { AlertCircle, AlertTriangle, CheckCircle2, Cpu, Info, Server } from 'lucide-preact';
import type { ToolCallData } from '@/shared/types';
import { FallbackOutput } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/FallbackOutput';
import { getToolInputAction } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';

interface Diagnostic {
  file?: unknown;
  path?: unknown;
  line?: unknown;
  column?: unknown;
  message?: unknown;
  severity?: unknown;
  code?: unknown;
  source?: unknown;
}

interface LspServerInfo {
  name: string;
  capabilities: Record<string, any>;
}

function severityOf(d: Diagnostic): 'error' | 'warning' | 'info' {
  const s = typeof d.severity === 'string' ? d.severity.toLowerCase() : '';
  if (s === 'error' || s === '1') return 'error';
  if (s === 'warning' || s === '2') return 'warning';
  return 'info';
}

const SEVERITY_STYLES = {
  error: {
    Icon: AlertCircle,
    color: 'text-error',
    text: 'text-error',
    badge: 'bg-error/10 text-error',
  },
  warning: {
    Icon: AlertTriangle,
    color: 'text-warning',
    text: 'text-warning',
    badge: 'bg-warning/10 text-warning',
  },
  info: {
    Icon: Info,
    color: 'text-ink/40',
    text: 'text-ink/70',
    badge: 'bg-ink/5 text-ink/50',
  },
} as const;

function locationOf(d: Diagnostic): string {
  const file = typeof d.file === 'string' ? d.file : typeof d.path === 'string' ? d.path : '';
  const line = typeof d.line === 'number' ? d.line : undefined;
  const col = typeof d.column === 'number' ? d.column : undefined;
  if (!file) return '';
  if (line === undefined) return file;
  return col === undefined ? `${file}:${line}` : `${file}:${line}:${col}`;
}

function parseLspOutput(output: string): Diagnostic[] {
  if (!output) return [];
  try {
    const data = JSON.parse(output);
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      if (Array.isArray(data.diagnostics)) return data.diagnostics;
      if (Array.isArray(data.errors)) return data.errors;
    }
  } catch {}

  const lines = output.split(/\r?\n/).filter(Boolean);
  const parsed: Diagnostic[] = [];
  const dirStack: string[] = [];
  let currentFile = '';

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip summary line like "23 hint(s):" or "0 error(s):"
    if (/^\d+\s+(?:error|warning|hint|info)\(s\):/i.test(trimmed)) {
      continue;
    }

    // Markdown directory/file headings: "# src/", "## App.tsx"
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const name = headingMatch[2].trim();
      dirStack.length = Math.min(dirStack.length, level - 1);
      if (name.endsWith('/')) {
        dirStack[level - 1] = name;
      } else {
        const fullDir = dirStack.filter(Boolean).join('');
        currentFile = fullDir ? `${fullDir.replace(/\/+$/, '')}/${name}` : name;
      }
      continue;
    }

    // Format: "  165:10 [hint] [typescript] 'isSyncing' is declared ... (6133)"
    const hierMatch = line.match(/^\s*(\d+):(\d+)\s+\[(error|warning|info|hint)\]\s*(?:\[([^\]]+)\])?\s*(.*?)(?:\s*\((\d+|TS\d+)\))?$/i);
    if (hierMatch) {
      parsed.push({
        file: currentFile || undefined,
        line: parseInt(hierMatch[1], 10),
        column: parseInt(hierMatch[2], 10),
        severity: hierMatch[3].toLowerCase() === 'hint' ? 'info' : hierMatch[3].toLowerCase(),
        source: hierMatch[4] || undefined,
        message: hierMatch[5].trim(),
        code: hierMatch[6] || undefined,
      });
      continue;
    }

    // Flat format: "file.tsx:18:5: error: message"
    const match = line.match(/^([^:\n]+):(\d+)(?::(\d+))?\s*[-:]?\s*(error|warning|info|hint)?\s*(?:(TS\d+|[A-Za-z0-9_-]+):)?\s*(.*)$/i);
    if (match) {
      parsed.push({
        file: match[1].trim(),
        line: parseInt(match[2], 10),
        column: match[3] ? parseInt(match[3], 10) : undefined,
        severity: match[4] ? (match[4].toLowerCase() === 'hint' ? 'info' : match[4].toLowerCase()) : 'error',
        code: match[5] || undefined,
        message: match[6]?.trim() || line,
      });
    }
  }
  return parsed;
}

function parseCapabilities(output: string): LspServerInfo[] {
  if (!output || !output.includes('capabilities:')) return [];
  const servers: LspServerInfo[] = [];

  // Match "server-name:\n  capabilities: { ... }" blocks
  const blocks = output.split(/^(?=[A-Za-z0-9_-]+:)/m);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const nameMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*capabilities:\s*(\{[\s\S]*\})/m);
    if (nameMatch) {
      const name = nameMatch[1];
      try {
        const capabilities = JSON.parse(nameMatch[2]);
        servers.push({ name, capabilities });
      } catch {
        servers.push({ name, capabilities: {} });
      }
    }
  }
  return servers;
}

/** Daftar diagnostics atau Server Capabilities untuk tool `lsp`. */
export function Lsp({ tool }: { tool: ToolCallData }) {
  const details = (tool.details ?? {}) as Record<string, any>;
  const output = tool.output ?? '';

  const isCapabilities =
    details.xdev?.args?.action === 'capabilities' ||
    getToolInputAction(tool.input) === 'capabilities' ||
    output.includes('capabilities:');

  const capabilities = useMemo(() => (isCapabilities ? parseCapabilities(output) : []), [isCapabilities, output]);

  const items: Diagnostic[] = useMemo(() => {
    if (isCapabilities) return [];
    return Array.isArray(details.diagnostics) ? details.diagnostics : parseLspOutput(output);
  }, [details.diagnostics, isCapabilities, output]);

  // View: LSP Server Capabilities
  if (isCapabilities && capabilities.length > 0) {
    return (
      <div className="space-y-2 select-text">
        <div className="overflow-hidden rounded-lg border border-ink/8 bg-paper">
          <div className="flex items-center justify-between border-b border-ink/6 bg-canvas/40 px-3 py-1.5">
            <div className="flex items-center gap-2">
              <Server size={13} className="text-ink/60" />
              <span className="font-mono text-[10.5px] font-semibold text-ink">Language Servers</span>
              <span className="rounded bg-ink/5 px-1.5 py-0.2 font-mono text-[10px] uppercase tracking-wider text-ink/50">
                Capabilities
              </span>
            </div>
            <span className="font-mono text-[10px] text-ink/40">{capabilities.length} active</span>
          </div>

          <div className="divide-y divide-ink/6 bg-canvas/30">
            {capabilities.map((srv, idx) => {
              const capKeys = Object.entries(srv.capabilities)
                .filter(([, v]) => Boolean(v))
                .map(([k]) => k.replace(/Provider$/, ''));

              return (
                <div key={idx} className="p-3 text-[11px]">
                  <div className="flex items-center gap-2">
                    <Cpu size={12} className="text-ink/50" />
                    <span className="font-mono font-medium text-ink">{srv.name}</span>
                    <span className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] text-success">
                      <CheckCircle2 size={10} />
                      Connected
                    </span>
                  </div>

                  {capKeys.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {capKeys.map((cap, i) => (
                        <span
                          key={i}
                          className="rounded bg-ink/5 px-1.5 py-0.5 font-mono text-[10px] text-ink/60"
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // View: Empty / Fallback
  if (items.length === 0) {
    if (!output) return null;
    return <FallbackOutput text={output} />;
  }

  // View: Diagnostics List
  const bySeverity = (sev: 'error' | 'warning' | 'info') => items.filter((d) => severityOf(d) === sev);
  const errorN = bySeverity('error').length;
  const warningN = bySeverity('warning').length;
  const infoN = bySeverity('info').length;

  return (
    <div className="overflow-hidden rounded-lg border border-ink/8 select-text">
      <div className="flex items-center gap-2 border-b border-ink/8 bg-paper px-2.5 py-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/40">
          Diagnostics
        </span>
        <span className="ml-auto flex items-center gap-2 font-mono text-[10px]">
          {errorN > 0 && <span className="flex items-center gap-1 text-error"><AlertCircle size={9} />{errorN}</span>}
          {warningN > 0 && <span className="flex items-center gap-1 text-warning"><AlertTriangle size={9} />{warningN}</span>}
          {infoN > 0 && <span className="flex items-center gap-1 text-ink/50"><Info size={9} />{infoN}</span>}
        </span>
      </div>
      <div className="divide-y divide-ink/6 bg-canvas/40 py-1 max-h-72 overflow-auto">
        {items.map((d, index) => {
          const sev = severityOf(d);
          const style = SEVERITY_STYLES[sev];
          const loc = locationOf(d);
          const msg = typeof d.message === 'string' ? d.message : '';
          const code = typeof d.code === 'string' ? d.code : undefined;
          const source = typeof d.source === 'string' ? d.source : undefined;

          const { Icon, color, text: textColor } = style;

          return (
            <div key={index} className="flex items-start gap-2 px-2.5 py-1.5 text-[11.5px]">
              <span className="flex h-5 w-3.5 shrink-0 items-center justify-center">
                <Icon size={12} className={color} />
              </span>
              <span className="min-w-0 flex-1 break-words leading-5">
                {loc && <span className="font-mono text-[10px] text-ink/45 mr-1">{loc}:</span>}
                <span className={textColor}>{msg}</span>
                {source && <span className="ml-1.5 font-mono text-[10px] text-ink/35">[{source}]</span>}
                {code && <span className="ml-1 font-mono text-[10px] text-ink/35">({code})</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
