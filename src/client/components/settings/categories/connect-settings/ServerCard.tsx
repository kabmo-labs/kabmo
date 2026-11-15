/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * This server's identity and the addresses it answers on.
 *
 * The identity is shown because a device pins it: when a phone refuses a server
 * that "looks right", the two ids are what the user compares. The addresses are
 * shown with their reason when they do not work — a LAN row on a loopback-only
 * listener says so, rather than looking like a broken network.
 */

import { Copy } from 'lucide-preact';
import type { ConnectAddress, ConnectStatus } from '@/shared/lib/connect/types';

const ROUTE_LABEL: Record<ConnectAddress['kind'], string> = {
  tailscale: 'Tailscale',
  lan: 'LAN',
  cloudflare: 'Cloudflare',
};

function copy(value: string): void {
  void navigator.clipboard?.writeText(value).catch(() => {
    // A clipboard the page cannot reach is not worth a dialog: the address is
    // on screen and selectable.
  });
}

export function ServerCard({ status }: { status: ConnectStatus }) {
  return (
    <section className="rounded-xl border border-ink/10 bg-paper">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink/10 px-4 py-3">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-ink">{status.label}</h4>
          <p className="mt-0.5 text-[11px] text-ink/60">kabmo {status.version}</p>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-mono uppercase tracking-wider text-ink/40">server id</div>
          <div className="font-mono text-[11px] text-ink/70" title={status.serverId}>
            {status.serverId.slice(0, 6)}…{status.serverId.slice(-4)}
          </div>
        </div>
      </header>

      <div className="px-4 py-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink/40">Addresses</div>
        {status.addresses.length === 0 ? (
          <p className="text-[11px] text-ink/60">
            No address yet. Turn on Tailscale Serve, or start this server with --lan.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {status.addresses.map((address) => {
              const usable = address.unavailable === null && address.url !== '';
              return (
                <li key={`${address.kind}:${address.url}`} className="flex items-start gap-2">
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${usable ? 'bg-ink' : 'bg-ink/25'}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="w-[74px] flex-shrink-0 text-[11px] font-semibold text-ink">
                        {ROUTE_LABEL[address.kind]}
                      </span>
                      <span className={`truncate font-mono text-[11px] ${usable ? 'text-ink/80' : 'text-ink/40'}`}>
                        {usable ? address.url : '—'}
                      </span>
                    </div>
                    {address.unavailable && (
                      <p className="mt-0.5 pl-[82px] text-[11px] leading-relaxed text-ink/55">{address.unavailable}</p>
                    )}
                  </div>
                  {usable && (
                    <button
                      type="button"
                      onClick={() => copy(address.url)}
                      aria-label={`Copy ${ROUTE_LABEL[address.kind]} address`}
                      className="flex-shrink-0 rounded-md p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
                    >
                      <Copy size={13} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
