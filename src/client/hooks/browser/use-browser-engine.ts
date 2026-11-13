/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Browser Agent panel's engine probe: which engine the agent will use, and
 * the one write that makes the panel able to mirror it.
 *
 * The panel mirrors Chromium over CDP; omp's WebKit engine has no CDP endpoint.
 * So the panel asks `/api/browser/engine` before it explains an empty view, and
 * its button sets `browser.webkit = false` through the same route. The write
 * takes effect for the NEXT open (omp reads the key at open time), which is why
 * the caller reconnects the stream after a successful switch.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { BrowserEnginePayload } from '@/shared/types';

export interface BrowserEngineController {
  /** The last answer, or null until the first one lands. */
  state: BrowserEnginePayload | null;
  loading: boolean;
  /** A switch to Chromium is in flight. */
  saving: boolean;
  /** The server's own refusal, or a transport failure. */
  error: string | null;
  refresh: () => void;
  /** Set `browser.webkit = false`; resolves true when the server accepted it. */
  useChromium: () => Promise<boolean>;
}

function readError(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  return typeof data.error === 'string' ? data.error : null;
}

export function useBrowserEngine(): BrowserEngineController {
  const [state, setState] = useState<BrowserEnginePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/browser/engine')
      .then((res) => res.json())
      .then((data: unknown) => {
        if (cancelled) return;
        const failure = readError(data);
        if (failure) {
          setError(failure);
          return;
        }
        setState(data as BrowserEnginePayload);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = useCallback(() => setNonce((value) => value + 1), []);

  const useChromium = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/browser/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webkit: false }),
      });
      const data: unknown = await res.json().catch(() => null);
      const failure = readError(data) ?? (res.ok ? null : `The write answered ${res.status}`);
      if (failure) {
        setError(failure);
        return false;
      }
      setState(data as BrowserEnginePayload);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { state, loading, saving, error, refresh, useChromium };
}
