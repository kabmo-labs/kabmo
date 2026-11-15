/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One tunnel provider: its switch, its state, and the sentence that explains it.
 *
 * The switch is the only control that changes anything, and it is disabled while
 * its own request is in flight — not while the other provider's is, because the
 * two are independent and a page that freezes both makes a slow Tailscale call
 * look like a broken Cloudflare row.
 *
 * The Cloudflare card states what it costs: TLS terminates at Cloudflare's edge,
 * so their machines read the console's password and every prompt. That belongs
 * on the card, not in a wiki, because it is the fact that decides whether the
 * user turns it on.
 */

import { Copy, ExternalLink } from 'lucide-preact';
import type { TunnelState } from '@/shared/lib/connect/types';

const PROVIDER_COPY: Record<TunnelState['provider'], { title: string; blurb: string }> = {
  tailscale: {
    title: 'Tailscale',
    blurb: 'Serve to your tailnet only. TLS ends on this machine, so Tailscale never sees the traffic.',
  },
  cloudflare: {
    title: 'Cloudflare',
    blurb: 'A public URL. Cloudflare terminates TLS and can read every request, including your password.',
  },
};

const PHASE_LABEL: Record<TunnelState['phase'], string> = {
  off: 'off',
  starting: 'starting…',
  up: 'connected',
  degraded: 'degraded',
  failed: 'unavailable',
};

export interface TunnelRowProps {
  tunnel: TunnelState;
  busy: boolean;
  onToggle: (next: 'start' | 'stop') => void;
}

export function TunnelRow({ tunnel, busy, onToggle }: TunnelRowProps) {
  const copy = PROVIDER_COPY[tunnel.provider];
  const on = tunnel.phase === 'up' || tunnel.phase === 'degraded';
  const canToggle = tunnel.phase !== 'failed';

  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h5 className="text-sm font-semibold text-ink">{copy.title}</h5>
            <span className="flex items-center gap-1 text-[11px] text-ink/60">
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-ink' : 'bg-ink/25'}`}
              />
              {PHASE_LABEL[tunnel.phase]}
            </span>
          </div>
          <p className="mt-1 max-w-[52ch] text-[11px] leading-relaxed text-ink/60">{copy.blurb}</p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={`${on ? 'Stop' : 'Start'} ${copy.title}`}
          disabled={busy || !canToggle}
          onClick={() => onToggle(on ? 'stop' : 'start')}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
            on ? 'bg-ink' : 'bg-ink/20'
          }`}
        >
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-paper shadow ring-0 transition duration-200 ease-in-out ${
              on ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {tunnel.url && (
        <div className="mt-2 flex items-center gap-1.5">
          <a
            href={tunnel.url}
            target="_blank"
            rel="noreferrer"
            className="truncate font-mono text-[11px] text-ink/80 underline decoration-ink/20 underline-offset-2 hover:decoration-ink/60"
          >
            {tunnel.url}
          </a>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(tunnel.url ?? '').catch(() => {})}
            aria-label={`Copy ${copy.title} address`}
            className="flex-shrink-0 rounded-md p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <Copy size={12} />
          </button>
          <a
            href={tunnel.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${copy.title} address`}
            className="flex-shrink-0 rounded-md p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <ExternalLink size={12} />
          </a>
        </div>
      )}

      {tunnel.reason && (
        <p className="mt-2 rounded-md border border-ink/10 bg-ink/[0.03] px-2.5 py-1.5 text-[11px] leading-relaxed text-ink/65">
          {tunnel.reason}
        </p>
      )}
    </div>
  );
}
