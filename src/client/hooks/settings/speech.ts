/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two speech facts that are NOT preferences: which hosted engines have a
 * key, and whether omp's local `say` command can run.
 *
 * Both are answered by the server (`GET /api/settings/speech`) because neither
 * can be read from the settings blob: a key is a credential the blob must not
 * carry, and the local capability depends on the installed omp process.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { TtsLocalCapability } from '@/shared/lib/tts/capability';
import type { TtsEngine } from '@/shared/lib/tts/engines';

export interface SpeechServerState {
  hasKeys: Record<string, boolean>;
  local: TtsLocalCapability;
}

export interface SpeechServerActions {
  state: SpeechServerState | null;
  /** A read failure, or a refusal from a write. */
  error: string | null;
  /** True while a write is in flight. */
  busy: boolean;
  reload: () => Promise<void>;
  saveKey: (engine: TtsEngine, apiKey: string) => Promise<boolean>;
  clearKey: (engine: TtsEngine) => Promise<boolean>;
  reprobe: () => Promise<void>;
}

const UNKNOWN: SpeechServerState = { hasKeys: {}, local: { available: false } };

async function post(body: unknown): Promise<{ ok: boolean; error?: string; body: Record<string, unknown> }> {
  try {
    const response = await fetch('/api/settings/speech', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    if (!response.ok) {
      return {
        ok: false,
        error: typeof record.error === 'string' ? record.error : `The speech route answered ${response.status}.`,
        body: record,
      };
    }
    return { ok: true, body: record };
  } catch {
    return { ok: false, error: 'Could not reach the speech settings route.', body: {} };
  }
}

function parseState(record: Record<string, unknown>): SpeechServerState {
  const settings = record.settings;
  const hasKeys: Record<string, boolean> = {};
  if (typeof settings === 'object' && settings !== null) {
    const keys = (settings as Record<string, unknown>).hasKeys;
    if (typeof keys === 'object' && keys !== null) {
      for (const [engine, value] of Object.entries(keys as Record<string, unknown>)) {
        if (value === true) hasKeys[engine] = true;
      }
    }
  }
  const local = record.local;
  return {
    hasKeys,
    local: typeof local === 'object' && local !== null
      ? {
          available: (local as Record<string, unknown>).available === true,
          ...(typeof (local as Record<string, unknown>).reason === 'string'
            ? { reason: String((local as Record<string, unknown>).reason) }
            : {}),
        }
      : { available: false },
  };
}

export function useSpeechServerState(): SpeechServerActions {
  const [state, setState] = useState<SpeechServerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/speech');
      const parsed: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof parsed !== 'object' || parsed === null) {
        setError(`The speech route answered ${response.status}.`);
        setState(UNKNOWN);
        return;
      }
      const record = parsed as Record<string, unknown>;
      setState(parseState(record));
      setError(typeof record.error === 'string' ? record.error : null);
    } catch {
      setError('Could not read the speech settings from the server.');
      setState(UNKNOWN);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveKey = useCallback(async (engine: TtsEngine, apiKey: string) => {
    setBusy(true);
    try {
      const answer = await post({ engine, apiKey });
      if (!answer.ok) {
        setError(answer.error ?? 'Could not save the API key.');
        return false;
      }
      setError(null);
      setState((previous) => ({
        ...(previous ?? UNKNOWN),
        hasKeys: { ...(previous ?? UNKNOWN).hasKeys, [engine]: true },
      }));
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearKey = useCallback(async (engine: TtsEngine) => {
    setBusy(true);
    try {
      const answer = await post({ engine, action: 'clear-key' });
      if (!answer.ok) {
        setError(answer.error ?? 'Could not clear the API key.');
        return false;
      }
      setError(null);
      setState((previous) => {
        const hasKeys = { ...(previous ?? UNKNOWN).hasKeys };
        delete hasKeys[engine];
        return { ...(previous ?? UNKNOWN), hasKeys };
      });
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const reprobe = useCallback(async () => {
    setBusy(true);
    try {
      const answer = await post({ action: 'probe' });
      if (!answer.ok) {
        setError(answer.error ?? 'Could not probe the local engine.');
        return;
      }
      setError(null);
      setState((previous) => ({
        ...(previous ?? UNKNOWN),
        local: parseState(answer.body).local,
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, reload, saveKey, clearKey, reprobe };
}
