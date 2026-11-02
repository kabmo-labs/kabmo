/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The server panel's own markup: one row per server, the empty state, and the
 * two footers a shell may or may not offer.
 *
 * Split from `ServerControl` so the trigger (a chip on a phone, a labelled
 * button in a desktop navbar) and the list can be read and tested apart. The
 * STORE is the control's, not the panel's: the old panel opened a second
 * `useShellServers`, which meant two copies of the list, two 4-second polls and
 * a trigger that could disagree with the rows directly under it.
 */

import { useState } from 'preact/hooks';
import { Check, Loader2, Play, Plus, RefreshCw, Server, Square, Trash2 } from 'lucide-preact';
import type { ShellServersStore } from '@/client/hooks/shell/servers';
import type { ShellServer } from '@/client/lib/shell/servers';
import { mobileOverlayStyle } from '@/shared/lib/ui/mobile-overlay';

export type ServerControlVariant = 'nav' | 'chip';

interface ServerPanelProps {
  open: boolean;
  onClose: () => void;
  /** `nav` hangs under a desktop navbar button; `chip` is a phone sheet. */
  variant: ServerControlVariant;
  store: ShellServersStore;
}

function statusLine(server: ShellServer): string {
  if (!server.running) return 'Stopped';
  const parts: string[] = [];
  if (server.version) parts.push(`v${server.version}`);
  if (server.mode) parts.push(server.mode);
  if (server.pid) parts.push(`pid ${server.pid}`);
  return parts.length > 0 ? parts.join(' · ') : 'Running';
}

function Row({
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
      {onRemove && !server.owned && (
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

/**
 * Which server this window is on, and how to change it.
 *
 * The panel lists two groups, and the split is the whole design:
 *
 * - **This window** — the servers the shell remembers, with the active one
 *   marked. A remote entry is a URL somebody typed; a managed entry is a local
 *   server this shell started, which is why it can be stopped here.
 * - **Found on this machine** — servers the shell did NOT start: `kabmo serve`
 *   in a terminal, `bun run dev`, a login entry. They are read from the
 *   per-port records the servers themselves write, so a server that appeared
 *   after the panel opened shows up on the next refresh. They can be connected
 *   to but not stopped — this window did not start them, and a Stop here would
 *   kill a process somebody else is watching.
 *
 * A phone answers neither group's second half: it cannot spawn a server, and it
 * has no per-port records on the device, so those two sections are ABSENT there
 * rather than drawn empty (`startable: false` and `detected: []` are the facts).
 *
 * A server is only offered as connectable while it ANSWERS: the shell probes
 * every URL before answering, so `running: false` is a real fact rather than a
 * guess, and the row says so instead of letting a click fail on a blank window.
 */
export function ServerPanel({ open, onClose, variant, store }: ServerPanelProps) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);

  if (!open) return null;

  const state = store.state;
  const entries = state?.entries ?? [];
  const detected = state?.detected ?? [];
  const activeId = state?.activeId;
  const startable = state?.startable !== false;

  const submit = async () => {
    if (!url.trim()) return;
    const ok = await store.add(label.trim(), url.trim());
    if (ok) {
      setLabel('');
      setUrl('');
      setAdding(false);
    }
  };

  // Desktop hangs under its navbar button; a phone pins to the VIEWPORT, because
  // its trigger sits in the drawer header and a 340px panel anchored there runs
  // off the right edge (measured at 390) and past the bottom in landscape.
  const placement =
    variant === 'chip'
      ? mobileOverlayStyle()
      : undefined;

  return (
    <div
      role="dialog"
      aria-label="Servers"
      className={
        variant === 'chip'
          ? 'fixed z-50 rounded-xl border border-ink/15 bg-paper shadow-xl overflow-hidden'
          : 'absolute right-2 top-full mt-1 z-50 w-[340px] rounded-xl border border-ink/15 bg-paper shadow-xl overflow-hidden'
      }
      style={placement}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink/10">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Server size={13} /> Servers
        </span>
        <button
          type="button"
          onClick={() => void store.reload()}
          disabled={store.busy}
          title="Refresh — re-probe every server"
          aria-label="Refresh servers"
          className="p-1 rounded text-ink/40 hover:text-ink hover:bg-ink/10 cursor-pointer disabled:opacity-40"
        >
          <RefreshCw size={12} className={store.busy ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="max-h-[320px] overflow-y-auto scrollbar-overlay-container px-2 py-2 space-y-1.5">
        {!state && (
          <p className="text-[11px] text-ink/50 px-1 py-2 flex items-center gap-1.5">
            <Loader2 size={12} className="animate-spin" /> Reading the server list…
          </p>
        )}

        {entries.length > 0 && (
          <>
            <p className="px-1 text-[9px] uppercase tracking-wide text-ink/35">This window</p>
            {entries.map((server) => (
              <Row
                key={server.id}
                server={server}
                active={server.id === activeId}
                busy={store.busy}
                onActivate={() => void store.activate(server.id)}
                onStop={() => void store.stop(server.id)}
                onRemove={() => void store.remove(server.id)}
              />
            ))}
          </>
        )}

        {detected.length > 0 && (
          <>
            <p className="px-1 pt-1 text-[9px] uppercase tracking-wide text-ink/35">
              Found on this machine
            </p>
            {detected.map((server) => (
              <Row
                key={server.id}
                server={server}
                active={server.url === state?.activeUrl}
                busy={store.busy}
                onActivate={() => void store.activate(server.id)}
              />
            ))}
          </>
        )}

        {state && entries.length === 0 && detected.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-ink/50">
            Nothing here yet. Add a server by address.
          </p>
        )}
      </div>

      {store.error && (
        <p className="px-3 py-1.5 text-[10px] text-error border-t border-ink/10">{store.error}</p>
      )}

      <div className="border-t border-ink/10 px-2 py-2 space-y-1.5">
        {/* A phone cannot spawn a server: there is no process to start and no
            terminal to own it. The control is ABSENT rather than disabled,
            because a disabled button would promise a capability the shell does
            not have. */}
        {startable && (
          <button
            type="button"
            onClick={() => void store.start()}
            disabled={store.busy}
            className="w-full flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-xs text-ink hover:bg-ink/5 cursor-pointer disabled:opacity-40"
          >
            <Play size={12} /> Start a local server
          </button>
        )}

        {adding ? (
          <form
            className="space-y-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <input
              autoFocus
              value={url}
              onInput={(event) => setUrl(event.currentTarget.value)}
              placeholder="192.168.1.10:3000"
              aria-label="Server address"
              className="w-full rounded-lg border border-ink/20 bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/45 font-mono"
            />
            <input
              value={label}
              onInput={(event) => setLabel(event.currentTarget.value)}
              placeholder="Label (optional)"
              aria-label="Server label"
              className="w-full rounded-lg border border-ink/20 bg-paper px-2 py-1.5 text-xs text-ink outline-none focus:border-ink/45"
            />
            <div className="flex gap-1.5">
              <button
                type="submit"
                disabled={store.busy || !url.trim()}
                className="flex-1 rounded-lg bg-ink text-paper px-2 py-1.5 text-xs cursor-pointer disabled:opacity-40"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded-lg border border-ink/15 px-2 py-1.5 text-xs text-ink/70 hover:bg-ink/5 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="w-full flex items-center gap-1.5 rounded-lg border border-ink/15 px-2.5 py-1.5 text-xs text-ink hover:bg-ink/5 cursor-pointer"
          >
            <Plus size={12} /> Add a server
          </button>
        )}
      </div>
    </div>
  );
}
