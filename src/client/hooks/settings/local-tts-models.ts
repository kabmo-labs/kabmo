/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The local speech models this install has, and the installs in flight.
 *
 * A server fact, not a preference: the settings blob holds the model id the user
 * picked, and only the server knows whether that directory still exists. The
 * hook polls while a job is running and stops the moment nothing is left to
 * watch — an install is minutes long, a finished one costs nothing.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { InstallJob, InstallStatus, LocalTtsModelInfo } from '@/shared/lib/tts/local-models';

export interface LocalModelInfo extends LocalTtsModelInfo {
  installedAt?: string;
}

export interface LocalTtsModelsState {
  models: LocalModelInfo[];
  catalog: LocalTtsModelInfo[];
  jobs: InstallJob[];
  /** The ONNX addon itself: absent on a platform it does not ship for. */
  runtime: { available: boolean; reason?: string };
}

export interface LocalTtsModelsActions {
  state: LocalTtsModelsState | null;
  error: string | null;
  busy: boolean;
  install: (input: { id?: string; url?: string }) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  reload: () => Promise<void>;
}

const POLL_MS = 1000;

/** True while a job is still doing work. */
export function jobRunning(status: InstallStatus): boolean {
  return status === 'downloading' || status === 'extracting' || status === 'probing';
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asModels(value: unknown): LocalModelInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asRecord(entry) as unknown as LocalModelInfo).filter((entry) => typeof entry.id === 'string');
}

function parse(payload: unknown): LocalTtsModelsState {
  const record = asRecord(payload);
  const runtime = asRecord(record.runtime);
  return {
    models: asModels(record.models),
    catalog: asModels(record.catalog),
    jobs: Array.isArray(record.jobs) ? (record.jobs as InstallJob[]) : [],
    runtime: {
      available: runtime.available === true,
      ...(typeof runtime.reason === 'string' ? { reason: runtime.reason } : {}),
    },
  };
}

async function post(body: unknown): Promise<{ ok: boolean; error?: string; body: Record<string, unknown> }> {
  try {
    const response = await fetch('/api/tts/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json().catch(() => null);
    const record = asRecord(parsed);
    if (!response.ok) {
      return {
        ok: false,
        error: typeof record.error === 'string' ? record.error : `The model route answered ${response.status}.`,
        body: record,
      };
    }
    return { ok: true, body: record };
  } catch {
    return { ok: false, error: 'Could not reach the model route.', body: {} };
  }
}

export function useLocalTtsModels(): LocalTtsModelsActions {
  const [state, setState] = useState<LocalTtsModelsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    try {
      const response = await fetch('/api/tts/models');
      const parsed: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const record = asRecord(parsed);
        setError(typeof record.error === 'string' ? record.error : `The model route answered ${response.status}.`);
        return;
      }
      if (!alive.current) return;
      setError(null);
      setState(parse(parsed));
    } catch {
      if (alive.current) setError('Could not reach the model route.');
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void reload();
    return () => {
      alive.current = false;
    };
  }, [reload]);

  // Poll only while something is being installed: a finished install is a
  // state, and a timer that kept asking would be one wake-up per second forever.
  const running = state?.jobs.some((job) => jobRunning(job.status)) ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, reload]);

  const install = useCallback(async (input: { id?: string; url?: string }) => {
    setBusy(true);
    setError(null);
    try {
      const result = await post({ action: 'install', ...input });
      if (!result.ok) {
        setError(result.error ?? 'The install could not start.');
        return false;
      }
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await post({ action: 'remove', id });
      if (!result.ok) {
        setError(result.error ?? 'The model could not be removed.');
        return false;
      }
      await reload();
      return true;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  return { state, error, busy, install, remove, reload };
}
