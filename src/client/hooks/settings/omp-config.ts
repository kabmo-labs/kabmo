/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Native omp config writes for the OMP Engine panel: the live snapshot, the
 * per-key save/reset state, and the "saved <key>" flash.
 *
 * Extracted from `OmpSettings` for the same reason `useModelRoles` was: it is a
 * self-contained store with three verbs and its own error surface, and the panel
 * was over the per-file ceiling. The load is still the panel's single
 * `Promise.all`, so `applyEntries` adopts its half of that payload.
 *
 * Every write keeps the server's OWN sentence. `omp config set` refuses a stale
 * key with "Unknown setting: <key>", a bad value with "Invalid value: …", and a
 * timeout with nothing at all — a bare "save failed" badge made all three read
 * the same.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ConfigEntry } from '@/server/lib/omp/config/config-cli';

export interface OmpConfigWrites {
  entries: Record<string, ConfigEntry>;
  /** Keys whose write is in flight. */
  savingKeys: Set<string>;
  /** Keys with a local draft the server does not hold. */
  dirtyKeys: Set<string>;
  /** Key → the refusal's sentence. */
  saveErrors: Map<string, string>;
  /** The key whose write just landed (cleared after a short flash). */
  savedKey: string | null;
  /** Adopt the `GET /api/settings/omp-config` entries. */
  applyEntries: (entries: Record<string, ConfigEntry>) => void;
  commitValue: (key: string, value: unknown) => Promise<boolean>;
  resetKey: (key: string) => Promise<boolean>;
  setDirty: (key: string, dirty: boolean) => void;
  /** Flash a badge for a write that does not own a config row (roles, extensions). */
  flashSaved: (key: string) => void;
}

export const SAVED_FLASH_MS = 2000;

interface WriteAnswer {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** POST one config write; never throws for a refusal. */
async function postConfig(body: unknown): Promise<WriteAnswer> {
  const res = await fetch('/api/settings/omp-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (typeof data !== 'object' || data === null) {
    return { ok: false, error: `The config route answered ${res.status} without a body` };
  }
  const ok = 'success' in data && data.success === true;
  const error = 'error' in data && typeof data.error === 'string' ? data.error : undefined;
  const value = 'value' in data ? data.value : undefined;
  return { ok, ...(error ? { error } : {}), ...(value === undefined ? {} : { value }) };
}

export function useOmpConfigWrites(): OmpConfigWrites {
  const [entries, setEntries] = useState<Record<string, ConfigEntry>>({});
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());
  const [dirtyKeys, setDirtyKeys] = useState<Set<string>>(new Set());
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => () => { mounted.current = false; }, []);

  const applyEntries = useCallback((next: Record<string, ConfigEntry>) => {
    setEntries(next);
  }, []);

  const flashSaved = useCallback((key: string) => {
    setSavedKey(key);
    setTimeout(() => setSavedKey((current) => (current === key ? null : current)), SAVED_FLASH_MS);
  }, []);

  /** Apply one write's outcome to the row state. */
  const applyWriteResult = useCallback((key: string, outcome: WriteAnswer) => {
    if (!mounted.current) return;
    setSavingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (outcome.ok) {
      setSaveErrors((prev) => {
        if (!prev.has(key)) return prev;
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      if (outcome.value !== undefined) {
        setEntries((prev) => ({ ...prev, [key]: { ...prev[key], value: outcome.value } }));
      }
      flashSaved(key);
    } else {
      setSaveErrors((prev) => new Map(prev).set(key, outcome.error ?? 'omp rejected the write'));
    }
  }, [flashSaved]);

  const runWrite = useCallback(async (key: string, body: unknown): Promise<boolean> => {
    setSavingKeys((prev) => new Set(prev).add(key));
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    try {
      const outcome = await postConfig(body);
      applyWriteResult(key, outcome);
      return outcome.ok;
    } catch (err) {
      console.error('Failed to write omp config:', err);
      applyWriteResult(key, { ok: false, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }, [applyWriteResult]);

  const commitValue = useCallback(
    (key: string, value: unknown) => runWrite(key, { key, value }),
    [runWrite],
  );
  const resetKey = useCallback(
    (key: string) => runWrite(key, { key, action: 'reset' }),
    [runWrite],
  );

  const setDirty = useCallback((key: string, dirty: boolean) => {
    setDirtyKeys((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  return {
    entries,
    savingKeys,
    dirtyKeys,
    saveErrors,
    savedKey,
    applyEntries,
    commitValue,
    resetKey,
    setDirty,
    flashSaved,
  };
}
