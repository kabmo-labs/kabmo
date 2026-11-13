/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The MCP half of the context popover: the servers this session has, each with
 * a switch that changes it for THIS session only, and an info control that
 * runs a real handshake and states the result.
 *
 * The status is a PROBE, never a guess: omp publishes no MCP state over RPC, so
 * "active" means the handshake answered and listed tools. The probe starts a
 * second instance of the server, which is why it runs on the info control and
 * not on mount.
 */

import { useState } from 'preact/hooks';
import { Info } from 'lucide-preact';
import { useSessionMcp } from '@/client/hooks/chat/context/mcp';
import { CHECKBOX_CLASS } from '@/client/components/common/checkbox/style';
import { mcpServerStatus, type McpServerStatus } from '@/shared/lib/mcp/status';
import type { SessionMcpServer } from '@/shared/types';

interface McpSectionProps {
  sessionId: string | null;
}

const STATUS_ICON_CLASS: Record<McpServerStatus, string> = {
  active: 'text-success',
  error: 'text-error',
  checking: 'text-warning',
  disabled: 'text-error',
  unknown: 'text-warning',
};

function statusDetail(server: SessionMcpServer, status: McpServerStatus): string {
  switch (status) {
    case 'active':
      return `Connected — ${server.probe?.toolCount ?? 0} tool${server.probe?.toolCount === 1 ? '' : 's'} in ${server.probe?.durationMs ?? 0}ms.`;
    case 'error':
      return `Failed — ${server.probe?.error ?? 'the handshake did not answer'}.`;
    case 'checking':
      return 'Checking the connection…';
    case 'disabled':
      return 'Disabled for this session.';
    default:
      return 'Not checked yet — click the icon to test the connection.';
  }
}

export function McpSection({ sessionId }: McpSectionProps) {
  const { servers, delivery, loading, error, pending, checking, toggle, probe } = useSessionMcp(sessionId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const enabledCount = servers.filter((server) => server.enabled).length;

  return (
    <div className="pt-2 mt-2 border-t border-ink/10">
      <div className="font-semibold text-ink font-sans pb-1.5 flex items-center justify-between">
        <span>MCP</span>
        {servers.length > 0 && (
          <span className="text-[10px] text-ink/50 font-mono">
            {enabledCount}/{servers.length}
          </span>
        )}
      </div>

      {loading && <div className="text-[11px] text-ink/50 italic font-sans">Loading…</div>}
      {error && <div className="text-[11px] text-error font-sans">{error}</div>}
      {!loading && !error && servers.length === 0 && (
        <div className="text-[11px] text-ink/50 italic font-sans">No MCP servers</div>
      )}

      {servers.length > 0 && (
        <ul className="space-y-0.5">
          {servers.map((server) => {
            const status = mcpServerStatus({
              enabled: server.enabled,
              checking: checking === server.name,
              probe: server.probe,
            });
            return (
              <li key={server.name}>
                <div className="flex items-center gap-2 py-0.5 rounded hover:bg-ink/5">
                  <label
                    className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                    title={`${server.name} (${server.source}, ${server.transport})`}
                  >
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      disabled={pending === server.name}
                      onChange={(event) => void toggle(server.name, event.currentTarget.checked)}
                      aria-label={`${server.enabled ? 'Disable' : 'Enable'} ${server.name} for this session`}
                      className={`${CHECKBOX_CLASS} size-3.5 flex-shrink-0`}
                    />
                    <span
                      className={`truncate font-sans ${server.enabled ? 'text-ink/80' : 'text-ink/40 line-through'}`}
                    >
                      {server.name}
                    </span>
                  </label>
                  <span className="text-[9px] uppercase tracking-wide text-ink/40 flex-shrink-0">
                    {server.transport}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded((current) => (current === server.name ? null : server.name));
                      if (server.enabled && checking !== server.name) void probe(server.name);
                    }}
                    className={`flex-shrink-0 cursor-pointer ${STATUS_ICON_CLASS[status]}`}
                    title={statusDetail(server, status)}
                    aria-label={`${server.name} status: ${status}`}
                    aria-expanded={expanded === server.name}
                  >
                    <Info size={12} />
                  </button>
                </div>
                {expanded === server.name && (
                  <div className="pl-5 pb-1 text-[10px] text-ink/60 font-sans">{statusDetail(server, status)}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {delivery === 'omp-config' && servers.length > 0 && (
        <div className="pt-1.5 text-[10px] text-ink/40 font-sans">Applies to this session only.</div>
      )}
    </div>
  );
}
