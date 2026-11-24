/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two dictation facts that are NOT preferences: whether an API key is stored,
 * and whether the local engine can actually start.
 *
 * Both are answered by the server (`GET /api/settings/dictation`) because neither
 * can be derived in the browser — the key is in a 0600 file the page must never
 * see, and the local engine is a child process on the machine running this
 * server. The preference itself is an ordinary setting and goes through the
 * `kabmo_settings` blob.
 */

import { useCallback, useEffect, useState } from 'preact/hooks';
import {
  parseLocalCapability,
  type LocalDictationCapability,
} from '@/shared/lib/dictation/capability';

export interface DictationServerState {
  hasApiKey: boolean;
  local: LocalDictationCapability;
}

export interface DictationServerActions {
  state: DictationServerState | null;
  /** A read failure, or a refusal from a write. */
  error: string | null;
  /** True while a write is in flight. */
  busy: boolean;
  reload: () => Promise<void>;
  saveApiKey: (apiKey: string) => Promise<boolean>;
  clearApiKey: () => Promise<boolean>;
  /** Re-run the local capability probe (after an omp update, say). */
  reprobe: () => Promise<void>;
}

const UNKNOWN: DictationServerState = { hasApiKey: false, local: { available: false } };

interface Answer {
  ok: boolean;
  error?: string;
  body: Record<string, unknown>;
}

async function post(body: Record<string, unknown>): Promise<Answer> {
  const response = await fetch('/api/settings/dictation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const parsed: unknown = await response.json().catch(() => null);
  const record = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  if (response.ok) return { ok: true, body: record };
  return {
    ok: false,
    body: record,
    error: typeof record.error === 'string' ? record.error : `The route answered ${response.status}.`,
  };
}

/** `GET /api/settings/dictation` → the two facts, or a sentence saying why not. */
function parseState(record: Record<string, unknown>): DictationServerState {
  const settings = record.settings;
  return {
    hasApiKey:
      typeof settings === 'object' && settings !== null && 'hasApiKey' in settings && settings.hasApiKey === true,
    local: parseLocalCapability(record.local),
  };
}

export function useDictationServerState(): DictationServerActions {
  const [state, setState] = useState<DictationServerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/settings/dictation');
      const parsed: unknown = await response.json().catch(() => null);
      if (!response.ok || typeof parsed !== 'object' || parsed === null) {
        setError(`The dictation route answered ${response.status}.`);
        setState(UNKNOWN);
        return;
      }
      const record = parsed as Record<string, unknown>;
      setState(parseState(record));
      setError(typeof record.error === 'string' ? record.error : null);
    } catch {
      setError('Could not read the dictation settings from the server.');
      setState(UNKNOWN);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const saveApiKey = useCallback(async (apiKey: string) => {
    setBusy(true);
    try {
      const answer = await post({ apiKey });
      if (!answer.ok) {
        setError(answer.error ?? 'Could not save the API key.');
        return false;
      }
      setError(null);
      setState((previous) => ({ ...(previous ?? UNKNOWN), hasApiKey: true }));
      return true;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearApiKey = useCallback(async () => {
    setBusy(true);
    try {
      const answer = await post({ action: 'clear-key' });
      if (!answer.ok) {
        setError(answer.error ?? 'Could not clear the API key.');
        return false;
      }
      setError(null);
      setState((previous) => ({ ...(previous ?? UNKNOWN), hasApiKey: false }));
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
        local: parseLocalCapability(answer.body.local),
      }));
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, error, busy, reload, saveApiKey, clearApiKey, reprobe };
}
