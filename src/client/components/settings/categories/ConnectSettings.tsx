/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Connect.
 *
 * Three blocks, one page: this server's identity and addresses, the two tunnel
 * providers, and the devices that have been paired. No master-detail, because
 * there is nothing to drill into — the only list is the device table, and it is
 * short by construction (a person pairs a handful of devices, not hundreds).
 *
 * The page's job is to make the route order visible. Tailscale is the preferred
 * route even on the same network: it is a direct WireGuard peer connection, so
 * it costs a fraction of a millisecond over the LAN address, and it is the only
 * one of the two that gives the page a secure origin — which is what keeps
 * dictation, clipboard read and the service worker working. The LAN row is the
 * fallback for a device with no tailnet, and it says so when it cannot answer.
 */

import { useCallback, useState } from 'preact/hooks';
import { useConnectStatus } from '@/client/hooks/connect/use-connect-status';
import { usePairing } from '@/client/hooks/connect/use-pairing';
import { ServerCard } from '@/client/components/settings/categories/connect-settings/ServerCard';
import { TunnelRow } from '@/client/components/settings/categories/connect-settings/TunnelRow';
import { DeviceTable } from '@/client/components/settings/categories/connect-settings/DeviceTable';
import { PairDialog } from '@/client/components/settings/categories/connect-settings/PairDialog';

export function ConnectSettings() {
  const { status, error, busy, refresh, setTunnel, revoke } = useConnectStatus();
  const pairing = usePairing();
  const [dialogOpen, setDialogOpen] = useState(false);

  const openDialog = useCallback(() => {
    setDialogOpen(true);
    void pairing.create();
  }, [pairing]);

  const closeDialog = useCallback(() => {
    setDialogOpen(false);
    pairing.reset();
    // A device that paired while the dialog was open appears on the next read;
    // the dialog has no way to know, so the page asks once it closes.
    void refresh();
  }, [pairing, refresh]);

  if (!status) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <p className="text-[11px] text-ink/60">{error ?? 'Reading the connection state…'}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <p className="text-[11px] leading-relaxed text-ink/60">
        Reach this server from your phone or another desktop without typing an address or a password.
      </p>

      {error && (
        <p className="rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
          {error}
        </p>
      )}

      <ServerCard status={status} />

      <section className="rounded-xl border border-ink/10 bg-paper">
        <header className="border-b border-ink/10 px-4 py-3">
          <h4 className="text-sm font-semibold text-ink">Tunnels</h4>
        </header>
        <div className="divide-y divide-ink/10">
          {status.tunnels.map((tunnel) => (
            <TunnelRow
              key={tunnel.provider}
              tunnel={tunnel}
              busy={busy === `${tunnel.provider}:start` || busy === `${tunnel.provider}:stop`}
              onToggle={(next) => void setTunnel(tunnel.provider, next)}
            />
          ))}
        </div>
      </section>

      <DeviceTable
        devices={status.devices}
        busy={busy}
        onRevoke={(id) => void revoke(id)}
        onAdd={openDialog}
      />

      {dialogOpen && (
        <PairDialog
          code={pairing.code}
          error={pairing.error}
          busy={pairing.busy}
          secondsLeft={pairing.secondsLeft}
          onClose={closeDialog}
          onRetry={() => void pairing.create()}
        />
      )}
    </div>
  );
}
