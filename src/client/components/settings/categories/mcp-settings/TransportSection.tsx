/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How the server is reached: a local command (stdio), a streamable HTTP
 * endpoint, or a legacy SSE endpoint.
 *
 * The three are separate transports in omp's schema, not a cosmetic label:
 * `type` is written into `mcp.json`, and an SSE endpoint sent as `http` fails
 * to connect. The selector therefore writes the transport, and the input below
 * it follows.
 */

import { Globe, Radio, Terminal } from 'lucide-preact';
import type { McpTransport } from '@/shared/types';

const OPTIONS: Array<{ value: McpTransport; label: string; icon: typeof Terminal }> = [
  { value: 'stdio', label: 'Command', icon: Terminal },
  { value: 'http', label: 'HTTP', icon: Globe },
  { value: 'sse', label: 'SSE', icon: Radio },
];

interface McpTransportSectionProps {
  transport: McpTransport;
  onTransportChange: (transport: McpTransport) => void;
  commandText: string;
  onCommandTextChange: (text: string) => void;
  linkUrl: string;
  onLinkUrlChange: (url: string) => void;
}

export function McpTransportSection({
  transport,
  onTransportChange,
  commandText,
  onCommandTextChange,
  linkUrl,
  onLinkUrlChange,
}: McpTransportSectionProps) {
  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-ink">How to reach it</h3>
        <p className="text-[11px] text-ink/60 mt-0.5">
          Paste the command that starts it, or the link to a hosted server.
        </p>
      </div>

      <div className="inline-flex rounded-lg border border-ink/20 p-0.5 bg-ink/5">
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onTransportChange(value)}
            aria-pressed={transport === value}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
              transport === value
                ? 'bg-paper text-ink shadow-2xs font-semibold'
                : 'text-ink/60 hover:text-ink'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {transport === 'stdio' ? (
        <div>
          <textarea
            value={commandText}
            onChange={(e) => onCommandTextChange(e.currentTarget.value)}
            rows={4}
            placeholder={`bunx\n@modelcontextprotocol/server-postgres\npostgresql://user:pass@host/db`}
            className="w-full text-xs font-mono p-3 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink resize-none leading-relaxed text-ink transition-colors"
          />
          <p className="text-[11px] text-ink/50 mt-1">
            Runs on this machine. Paste a whole command and it is split into one argument per line.
          </p>
        </div>
      ) : (
        <div>
          <input
            type="url"
            value={linkUrl}
            onChange={(e) => onLinkUrlChange(e.currentTarget.value)}
            placeholder={transport === 'sse' ? 'https://example.com/sse' : 'https://needmcp.com/mcp'}
            className="w-full text-xs font-mono px-3 py-2 rounded-lg border border-ink/20 hover:border-ink/40 bg-ink/5 focus:outline-none focus:border-ink text-ink transition-colors"
          />
          <p className="text-[11px] text-ink/50 mt-1">
            {transport === 'sse'
              ? 'Legacy SSE endpoint. Prefer HTTP unless the server only speaks SSE.'
              : 'Streamable HTTP endpoint. Add headers below when it needs a token.'}
          </p>
        </div>
      )}
    </div>
  );
}
