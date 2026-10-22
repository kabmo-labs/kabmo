/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model role editor — `role → model selector` overrides in config.yml, with
 * presets.
 *
 * Roles come from omp's own `MODEL_ROLES` table (see
 * `@/shared/lib/omp/config/model-roles`), and the candidate models from omp's
 * own catalog, so a row can only name a model omp can resolve. Writes go
 * through `/api/model-roles`: `PUT` replaces the whole map (an empty value
 * removes that role's override), `POST` saves a preset, `DELETE` removes one.
 *
 * Two things this panel used to get wrong and must not again:
 *
 *   - **A role row was a free-text `provider/model` field.** That is a value a
 *     user cannot type reliably, and a typo is invisible: omp falls back to its
 *     own resolution and the role silently runs on a different model. Every row
 *     is a picker over the catalog now, with the stored value kept selectable
 *     even when the catalog no longer lists it.
 *   - **`widget` was missing from the role table** (omp 18.12.6), which made it
 *     the one role unreachable from the console.
 *
 * The presets are the reason this panel exists in its current shape: switching
 * a whole role map used to mean sixteen edits. Two facts are kept apart on
 * purpose — the SELECTED preset (the target of Update/Delete, which a hand edit
 * must not clear, or the save-back flow would be impossible) and whether the
 * live map still equals it (`in use` vs `modified`).
 */

import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { AlertCircle, Check } from 'lucide-preact';
import { candidatesForRole, matchPreset, MODEL_ROLES, roleMapsEqual, ROLE_IDS } from '@/shared/lib/omp/config/model-roles';
import type { ModelRoleCandidate, ModelRolePreset } from '@/shared/types/model-roles';
import { RoleRow } from '@/client/components/settings/categories/omp-settings/RoleRow';
import { PresetBar } from '@/client/components/settings/categories/omp-settings/PresetBar';

interface RoleEditorProps {
  roles: Record<string, string>;
  presets: ModelRolePreset[];
  candidates: ModelRoleCandidate[];
  /** Why the catalog could not be read; the rows still render. */
  candidatesError?: string | null;
  /** Replace the whole map (an empty value removes that role's override). */
  onSaveRoles: (roles: Record<string, string>) => Promise<boolean>;
  onSavePreset: (name: string, roles: Record<string, string>) => Promise<boolean>;
  onUpdatePreset: (preset: ModelRolePreset) => Promise<boolean>;
  onDeletePreset: (preset: ModelRolePreset) => Promise<boolean>;
  savedRole: string | null;
  /** The last write's refusal; shown in place so a rejected save is not silent. */
  writeError?: string | null;
  onDismissWriteError?: () => void;
}

const SECTIONS: Array<{ id: 'chat' | 'kind'; title: string; note: string }> = [
  {
    id: 'chat',
    title: 'Chat roles',
    note: 'Each takes a chat model. “omp default” removes the override and omp resolves the role itself.',
  },
  {
    id: 'kind',
    title: 'Model-kind roles',
    note: 'Each takes a model of that kind only — a chat model here is silently unusable.',
  },
];

export function RoleEditor({
  roles,
  presets,
  candidates,
  candidatesError,
  onSaveRoles,
  onSavePreset,
  onUpdatePreset,
  onDeletePreset,
  savedRole,
  writeError,
  onDismissWriteError,
}: RoleEditorProps) {
  const [draft, setDraft] = useState<Record<string, string>>(roles);
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(() => matchPreset(presets, roles)?.id ?? null);

  // The server's map is the truth; a save answers with the stored copy.
  useEffect(() => { setDraft(roles); }, [roles]);

  /**
   * Keep the selection honest as the list and the map arrive:
   *  - a deleted preset cannot stay selected;
   *  - with nothing selected, a map that equals a preset adopts it — this is the
   *    load path (the payload lands after mount) and a reload of a saved state.
   * A hand edit does NOT clear the selection: it is the target of `Update`.
   */
  useEffect(() => {
    setSelectedId((current) => {
      if (current && !presets.some((preset) => preset.id === current)) return null;
      if (current) return current;
      return matchPreset(presets, draft)?.id ?? null;
    });
  }, [presets, draft]);

  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedId) ?? null,
    [presets, selectedId],
  );
  const inUse = useMemo(
    () => Boolean(selectedPreset && roleMapsEqual(selectedPreset.roles, draft)),
    [selectedPreset, draft],
  );

  const commit = useCallback(async (next: Record<string, string>) => {
    setDraft(next);
    setBusy(true);
    try {
      await onSaveRoles(next);
    } finally {
      setBusy(false);
    }
  }, [onSaveRoles]);

  const changeRole = useCallback((role: string, value: string) => {
    const next = { ...draft };
    if (value) next[role] = value;
    else delete next[role];
    void commit(next);
  }, [commit, draft]);

  const applyPreset = useCallback((preset: ModelRolePreset) => {
    setSelectedId(preset.id);
    void commit({ ...preset.roles });
  }, [commit]);

  const saveAs = useCallback(async (name: string) => {
    setBusy(true);
    try {
      await onSavePreset(name, draft);
    } finally {
      setBusy(false);
    }
  }, [draft, onSavePreset]);

  const update = useCallback(async () => {
    if (!selectedPreset) return;
    setBusy(true);
    try {
      await onUpdatePreset({ ...selectedPreset, roles: draft });
    } finally {
      setBusy(false);
    }
  }, [selectedPreset, draft, onUpdatePreset]);

  const remove = useCallback(async () => {
    if (!selectedPreset) return;
    setBusy(true);
    try {
      await onDeletePreset(selectedPreset);
      setSelectedId(null);
    } finally {
      setBusy(false);
    }
  }, [selectedPreset, onDeletePreset]);

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Model Roles</h3>
          <p className="text-ink/50 mt-0.5">
            Role → model selectors from config.yml. Pick a preset to switch every role at once.
          </p>
        </div>
        {savedRole && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink/60"><Check size={11} /> saved</span>
        )}
      </div>

      <PresetBar
        presets={presets}
        selectedPreset={selectedPreset}
        inUse={inUse}
        busy={busy}
        onApply={applyPreset}
        onSave={saveAs}
        onUpdate={update}
        onDelete={remove}
      />

      {writeError && (
        <div className="flex items-start gap-1.5 pb-2 text-[10px] text-error">
          <AlertCircle size={11} className="mt-px flex-shrink-0" />
          <span className="flex-1">{writeError}</span>
          {onDismissWriteError && (
            <button
              type="button"
              onClick={onDismissWriteError}
              className="text-ink/40 hover:text-ink cursor-pointer"
              aria-label="Dismiss role write error"
            >
              ×
            </button>
          )}
        </div>
      )}

      {candidatesError && (
        <div className="flex items-start gap-1.5 pb-2 text-[10px] text-warning">
          <AlertCircle size={11} className="mt-px flex-shrink-0" />
          <span>
            Model catalog unavailable ({candidatesError}). Stored selectors stay editable; new picks need a working
            omp install.
          </span>
        </div>
      )}

      {SECTIONS.map((section) => {
        const sectionRoles = ROLE_IDS.filter((role) => MODEL_ROLES[role].section === section.id);
        return (
          <div key={section.id} className="mb-3">
            <div className="pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">{section.title}</div>
              <div className="text-[10px] text-ink/40 leading-snug">{section.note}</div>
            </div>
            <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
              {sectionRoles.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  info={MODEL_ROLES[role]}
                  value={draft[role] ?? ''}
                  candidates={candidatesForRole(role, candidates)}
                  disabled={busy}
                  onChange={changeRole}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
