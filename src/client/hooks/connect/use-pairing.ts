/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Minting a pairing code, and the countdown that makes its life visible.
 *
 * The code is single-use and expires in two minutes, so the dialog has to say
 * both things and show the clock. A code that silently stops working is
 * indistinguishable from a broken camera, and the user's next move — rescan,
 * restart the app — is the wrong one.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { ConnectCandidate } from '@/shared/lib/connect/types';

export interface PairingCode {
  pairingId: string;
  expiresAt: string;
  /** The `kabmo://` deep link, for a native shell that registers the scheme. */
  link: string;
  /** The `https://…/pair#…` link a browser can open. This is what the QR holds. */
  webLink: string;
  /** The same code as a downloadable PNG, served by this origin. */
  qrUrl: string;
  candidates: ConnectCandidate[];
  qr: { size: number; rows: string[] };
}

export interface UsePairingResult {
  code: PairingCode | null;
  error: string | null;
  busy: boolean;
  /** Seconds left before the code stops working; 0 once it has. */
  secondsLeft: number;
  create: () => Promise<void>;
  reset: () => void;
}

interface PairingEnvelope extends Partial<PairingCode> {
  error?: string;
}

export function usePairing(): UsePairingResult {
  const [code, setCode] = useState<PairingCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/connect/pair', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'create' }),
      });
      const payload = (await response.json().catch(() => null)) as PairingEnvelope | null;
      if (!response.ok || !payload?.qr || !payload.link) {
        setError(payload?.error ?? `Could not create a pairing code (HTTP ${response.status}).`);
        setCode(null);
        return;
      }
      setCode({
        pairingId: payload.pairingId ?? '',
        expiresAt: payload.expiresAt ?? '',
        link: payload.link,
        webLink: payload.webLink ?? payload.link,
        // A server too old to serve the PNG still mints a scannable code; the
        // dialog then leaves the download out rather than pointing it at nothing.
        qrUrl: payload.qrUrl ?? '',
        candidates: payload.candidates ?? [],
        qr: payload.qr,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a pairing code.');
      setCode(null);
    } finally {
      setBusy(false);
    }
  }, []);

  const reset = useCallback(() => {
    setCode(null);
    setError(null);
    setSecondsLeft(0);
  }, []);

  // The countdown is derived from the server's own `expiresAt`, not from a
  // local two-minute timer: a clock that started when the dialog opened would
  // keep counting through a slow request and claim time the code never had.
  useEffect(() => {
    if (!code) return;
    const deadline = Date.parse(code.expiresAt);
    if (!Number.isFinite(deadline)) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [code]);

  return { code, error, busy, secondsLeft, create, reset };
}
