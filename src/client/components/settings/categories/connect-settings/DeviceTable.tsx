/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paired devices, and the one action that matters on each row.
 *
 * The route and round trip are what the DEVICE reported, not something the
 * server measured — it cannot measure a phone's latency. Showing them is what
 * makes the fallback order visible: a phone on Tailscale at home and the same
 * phone on Cloudflare at a café are two different rows of the same device, and
 * the user can see which one it is using right now.
 *
 * A table on a desktop, stacked rows on a phone. The columns are the same facts
 * in both; only the arrangement changes, because a horizontally scrolling table
 * on a phone hides the revoke button off-screen.
 */

import { Trash2 } from 'lucide-preact';
import type { PairedDevice } from '@/shared/lib/connect/types';

const ROUTE_LABEL: Record<NonNullable<PairedDevice['route']>, string> = {
  tailscale: 'Tailscale',
  lan: 'LAN',
  cloudflare: 'Cloudflare',
};

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'never';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export interface DeviceTableProps {
  devices: PairedDevice[];
  busy: string | null;
  onRevoke: (id: string) => void;
  onAdd: () => void;
}

export function DeviceTable({ devices, busy, onRevoke, onAdd }: DeviceTableProps) {
  return (
    <section className="rounded-xl border border-ink/10 bg-paper">
      <header className="flex items-center justify-between gap-2 border-b border-ink/10 px-4 py-3">
        <h4 className="text-sm font-semibold text-ink">Paired devices</h4>
        <button
          type="button"
          onClick={onAdd}
          className="rounded-lg border border-ink/15 px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors hover:bg-ink/5"
        >
          Add a device
        </button>
      </header>

      {devices.length === 0 ? (
        <div className="px-4 py-6">
          <p className="text-[11px] leading-relaxed text-ink/60">
            No device has been paired yet. Add one to reach this server from your phone without typing an
            address or a password.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop: one row per device. */}
          <table className="hidden w-full md:table">
            <thead>
              <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-ink/40">
                <th className="px-4 py-2 font-bold">Device</th>
                <th className="px-2 py-2 font-bold">Platform</th>
                <th className="px-2 py-2 font-bold">Route</th>
                <th className="px-2 py-2 font-bold">RTT</th>
                <th className="px-2 py-2 font-bold">Last seen</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id} className="border-t border-ink/5">
                  <td className="px-4 py-2 text-[12px] font-medium text-ink">{device.name}</td>
                  <td className="px-2 py-2 text-[11px] text-ink/70">{device.platform}</td>
                  <td className="px-2 py-2 text-[11px] text-ink/70">
                    {device.route ? ROUTE_LABEL[device.route] : '—'}
                  </td>
                  <td className="px-2 py-2 font-mono text-[11px] tabular-nums text-ink/70">
                    {device.rttMs === null ? '—' : `${device.rttMs} ms`}
                  </td>
                  <td className="px-2 py-2 text-[11px] text-ink/60">{relative(device.lastSeenAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => onRevoke(device.id)}
                      disabled={busy === `device:${device.id}`}
                      aria-label={`Revoke ${device.name}`}
                      className="rounded-md p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Phone: the same facts, stacked. */}
          <ul className="divide-y divide-ink/5 md:hidden">
            {devices.map((device) => (
              <li key={device.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="text-[12px] font-medium text-ink">{device.name}</div>
                  <div className="mt-0.5 text-[11px] text-ink/60">
                    {device.platform}
                    {device.route ? ` · ${ROUTE_LABEL[device.route]}` : ''}
                    {device.rttMs === null ? '' : ` · ${device.rttMs} ms`}
                    {` · ${relative(device.lastSeenAt)}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRevoke(device.id)}
                  disabled={busy === `device:${device.id}`}
                  aria-label={`Revoke ${device.name}`}
                  className="flex-shrink-0 rounded-md p-1.5 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink disabled:opacity-50"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="border-t border-ink/10 px-4 py-2.5 text-[11px] leading-relaxed text-ink/55">
        Each device holds its own token. Revoking cuts it off immediately; pair it again with a new code.
      </p>
    </section>
  );
}
