/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model-role state for the OMP Engine panel: the live `modelRoles` map, the
 * stored presets, and the catalog the role dropdowns offer.
 *
 * Extracted from `OmpSettings` because it is a self-contained store with its own
 * three writes, and because the panel file was crossing the per-file ceiling.
 * The load is still driven by the panel (it fetches everything in one
 * `Promise.all` so a single spinner covers the whole screen), so this hook
 * exposes `applyPayload` for that fetch and `reload` for a standalone refresh.
 *
 * Every write answers with the WHOLE list/map from the server and is adopted
 * verbatim: the route normalizes (blank selectors dropped, the map written
 * whole), so the panel shows what config.yml and the table actually hold rather
 * than an optimistic guess that can drift.
 */

import { useCallback, useState } from 'preact/hooks';
import type { ModelRoleCandidate, ModelRolePreset } from '@/shared/types/model-roles';

export interface ModelRoleState {
  roles: Record<string, string>;
  presets: ModelRolePreset[];
  candidates: ModelRoleCandidate[];
  candidatesError: string | null;
  /** The last write's refusal (omp's or the table's own sentence), cleared on the next write. */
  writeError: string | null;
  clearWriteError: () => void;
  /** Adopt the `GET /api/model-roles` payload (the panel's combined load). */
  applyPayload: (data: unknown) => void;
  /** Replace the whole map — a single role edit and applying a preset both. */
  writeRoles: (roles: Record<string, string>) => Promise<boolean>;
  savePreset: (name: string, roles: Record<string, string>) => Promise<boolean>;
  updatePreset: (preset: ModelRolePreset) => Promise<boolean>;
  deletePreset: (preset: ModelRolePreset) => Promise<boolean>;
}

function readRoles(data: unknown): Record<string, string> | null {
  if (typeof data !== 'object' || data === null || !('roles' in data)) return null;
  const roles = data.roles;
  if (typeof roles !== 'object' || roles === null || Array.isArray(roles)) return null;
  return Object.fromEntries(
    Object.entries(roles).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** The server's own refusal sentence, when the payload carries one. */
function errorText(data: unknown): string | null {
  if (typeof data !== 'object' || data === null || !('error' in data)) return null;
  return typeof data.error === 'string' ? data.error : null;
}

export function useModelRoles(onSaved: (key: string) => void): ModelRoleState {
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<ModelRolePreset[]>([]);
  const [candidates, setCandidates] = useState<ModelRoleCandidate[]>([]);
  const [candidatesError, setCandidatesError] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);

  const clearWriteError = useCallback(() => setWriteError(null), []);

  const applyPayload = useCallback((data: unknown) => {
    const nextRoles = readRoles(data);
    if (nextRoles) setRoles(nextRoles);
    if (typeof data !== 'object' || data === null) return;
    if ('presets' in data && Array.isArray(data.presets)) setPresets(data.presets as ModelRolePreset[]);
    if ('candidates' in data && Array.isArray(data.candidates)) setCandidates(data.candidates as ModelRoleCandidate[]);
    if ('candidatesError' in data) {
      setCandidatesError(typeof data.candidatesError === 'string' ? data.candidatesError : null);
    }
  }, []);

  const writeRoles = useCallback(async (next: Record<string, string>): Promise<boolean> => {
    // The previous map, so a refusal puts the rows back: leaving the optimistic
    // draft on screen after config.yml rejected it would show a role assignment
    // that does not exist, and the next edit would build on it.
    const previous = roles;
    setRoles(next);
    setWriteError(null);
    try {
      const res = await fetch('/api/model-roles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roles: next }),
      });
      const data: unknown = await res.json();
      const stored = readRoles(data);
      if (stored) setRoles(stored);
      const ok = typeof data === 'object' && data !== null && 'success' in data && data.success === true;
      if (ok) onSaved('role-map');
      else {
        setRoles(previous);
        setWriteError(errorText(data) ?? 'The role write was refused');
      }
      return ok;
    } catch (err) {
      console.error('Failed to save model roles:', err);
      setRoles(previous);
      setWriteError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, [onSaved, roles]);

  /** Save/update/delete a preset; every answer carries the whole preset list. */
  const writePreset = useCallback(async (init: RequestInit, query = ''): Promise<boolean> => {
    setWriteError(null);
    try {
      const res = await fetch(`/api/model-roles${query}`, init);
      const data: unknown = await res.json();
      if (typeof data === 'object' && data !== null && 'presets' in data && Array.isArray(data.presets)) {
        setPresets(data.presets as ModelRolePreset[]);
      }
      const ok = typeof data === 'object' && data !== null && 'success' in data && data.success === true;
      if (!ok) setWriteError(errorText(data) ?? 'The preset write was refused');
      return ok;
    } catch (err) {
      console.error('Failed to save model role preset:', err);
      setWriteError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }, []);

  const savePreset = useCallback((name: string, map: Record<string, string>) => writePreset({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: { name, roles: map } }),
  }), [writePreset]);

  const updatePreset = useCallback((preset: ModelRolePreset) => writePreset({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset: { id: preset.id, name: preset.name, roles: preset.roles } }),
  }), [writePreset]);

  const deletePreset = useCallback((preset: ModelRolePreset) => writePreset({
    method: 'DELETE',
  }, `?id=${encodeURIComponent(preset.id)}`), [writePreset]);

  return {
    roles,
    presets,
    candidates,
    candidatesError,
    writeError,
    clearWriteError,
    applyPayload,
    writeRoles,
    savePreset,
    updatePreset,
    deletePreset,
  };
}
