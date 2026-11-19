/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One row of the server list: the status dot, the label and address, and the
 * one action this row may offer.
 *
 * Split from `Panel.tsx` for the 350-line ceiling, and because the row's rules
 * are its own: Stop belongs to a server this shell started and that still
 * answers, Remove to everything else — a remote entry, a hand-started instance,
 * or a server this shell started that has since died. The last case is why
 * `!owned || !running`: a dead owned row used to have NO action at all and
 * could not be cleared without reloading the page.
 */

import { Check, Square, Trash2 } from 'lucide-preact';
import type { ShellServer } from '@/client/lib/shell/servers';

export function statusLine(server: ShellServer): string {
  if (!server.running) return 'Stopped';
  const parts: string[] = [];
  if (server.version) parts.push(`v${server.version}`);
  if (server.mode) parts.push(server.mode);
  if (server.pid) parts.push(`pid ${server.pid}`);
  return parts.length > 0 ? parts.join(' · ') : 'Running';
}

export function Row({
  server,
  active,
  busy,
  onActivate,
  onStop,
  onRemove,
}: {
  server: ShellServer;
  active: boolean;
  busy: boolean;
  onActivate: () => void;
  onStop?: () => void;
  onRemove?: () => void;
}) {
  const canConnect = server.running && !active;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 ${
        active ? 'border-ink/30 bg-ink/[0.04]' : 'border-ink/10'
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
          server.running ? 'bg-success' : 'bg-ink/25'
        }`}
        aria-hidden="true"
      />
      <button
        type="button"
        onClick={onActivate}
        disabled={busy || !canConnect}
        title={canConnect ? `Switch to ${server.label}` : statusLine(server)}
        className="flex-1 min-w-0 text-left cursor-pointer disabled:cursor-default group"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-ink truncate">{server.label}</span>
          {active && <Check size={12} className="text-success flex-shrink-0" aria-label="Active" />}
        </span>
        <span className="block text-[10px] text-ink/50 truncate font-mono">{server.url}</span>
        <span className="block text-[10px] text-ink/40 truncate">{statusLine(server)}</span>
      </button>
      {onStop && server.owned && server.running && (
        <button
          type="button"
          onClick={onStop}
          disabled={busy}
          title="Stop this local server"
          aria-label={`Stop ${server.label}`}
          className="p-1 rounded text-ink/40 hover:text-error hover:bg-error/10 cursor-pointer disabled:opacity-40"
        >
          <Square size={12} />
        </button>
      )}
      {onRemove && (!server.owned || !server.running) && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          title="Remove from the list"
          aria-label={`Remove ${server.label}`}
          className="p-1 rounded text-ink/40 hover:text-error hover:bg-error/10 cursor-pointer disabled:opacity-40"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}
