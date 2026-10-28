/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Preset switcher for the model-role editor.
 *
 * The problem it solves: a role map is up to sixteen assignments, and switching
 * between "everything on the cheap model" and "everything on the thinking model"
 * used to mean sixteen edits. A preset is that map under a name (stored in
 * Kabmo's own `model_role_presets` table), and choosing one APPLIES it.
 *
 * Three behaviours are deliberate:
 *
 *   - **Choosing a preset applies it immediately.** A preset picker with a
 *     separate Apply button makes the control's state ambiguous ("selected but
 *     not in force"), and the write is one `PUT` of a map the user can re-apply
 *     from the same list. The list is the switch.
 *   - **The selected preset survives an edit, and "in use" does not.** They are
 *     two different facts: the selection is what `Update` would overwrite, while
 *     `in use` means the live map still equals it. Tying both to the comparison
 *     made `Update` unreachable in the exact flow it exists for — pick a preset,
 *     tweak one role, save the tweak back into it — because the edit moved the
 *     picker to `Custom` and disabled the button. So the picker reads
 *     `preset · modified` while they differ, and `in use` only while they agree.
 *   - **Overwriting and deleting both ask first, in place.** `Save as…` names a
 *     new preset; `Update` overwrites the SELECTED one (never a guess), and
 *     Delete confirms inline before removing the record.
 */

import { useState } from 'preact/hooks';
import { Check, Plus, Save, Trash2 } from 'lucide-preact';
import type { ModelRolePreset } from '@/shared/types/model-roles';

interface PresetBarProps {
  presets: ModelRolePreset[];
  /** Preset the user picked; the target of Update/Delete. */
  selectedPreset: ModelRolePreset | null;
  /** Whether the live role map still equals the selected preset. */
  inUse: boolean;
  /** A write is in flight; every control is disabled rather than racing it. */
  busy: boolean;
  onApply: (preset: ModelRolePreset) => void;
  onSave: (name: string) => void;
  onUpdate: () => void;
  onDelete: () => void;
}

export function PresetBar({
  presets,
  selectedPreset,
  inUse,
  busy,
  onApply,
  onSave,
  onUpdate,
  onDelete,
}: PresetBarProps) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const commitNew = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
    setCreating(false);
  };

  return (
    <div className="rounded-lg border border-ink/10 bg-ink/[0.02] px-3 py-2 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">Preset</span>
        <select
          aria-label="Model role preset"
          value={selectedPreset?.id ?? ''}
          disabled={busy || presets.length === 0}
          onChange={(event) => {
            const chosen = presets.find((preset) => preset.id === event.currentTarget.value);
            if (chosen) onApply(chosen);
          }}
          className="bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-[11px] cursor-pointer disabled:opacity-50 min-w-[10rem]"
        >
          <option value="">{presets.length === 0 ? 'No presets yet' : 'Custom'}</option>
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.name}</option>
          ))}
        </select>

        {selectedPreset && (
          <span
            className={`inline-flex items-center gap-1 text-[10px] ${inUse ? 'text-ink/50' : 'text-warning'}`}
            title={inUse ? 'The live roles are this preset' : 'The roles differ from this preset — Update stores them'}
          >
            {inUse ? <><Check size={11} /> in use</> : 'modified'}
          </span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setCreating((open) => !open)}
            disabled={busy}
            title="Save the current roles as a new preset"
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50 text-[11px]"
          >
            <Plus size={11} /> Save as…
          </button>
          <button
            type="button"
            onClick={onUpdate}
            disabled={busy || !selectedPreset}
            title={selectedPreset ? `Overwrite “${selectedPreset.name}” with the current roles` : 'Pick a preset first'}
            className="flex items-center gap-1 px-2 py-1 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-40 text-[11px]"
          >
            <Save size={11} /> Update
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy || !selectedPreset}
            title={selectedPreset ? `Delete “${selectedPreset.name}”` : 'Pick a preset first'}
            className="p-1 rounded-md border border-ink/15 text-ink/50 hover:text-error hover:border-error/40 transition-colors cursor-pointer disabled:opacity-40"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {creating && (
        <div className="flex items-center gap-2 pt-2">
          <input
            aria-label="New preset name"
            type="text"
            value={name}
            autoFocus
            onInput={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitNew();
              if (event.key === 'Escape') { setCreating(false); setName(''); }
            }}
            placeholder="e.g. cheap, thinking, review"
            className="flex-1 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-[11px]"
          />
          <button
            type="button"
            onClick={commitNew}
            disabled={!name.trim() || busy}
            className="px-2 py-1 rounded-md border border-ink/15 text-ink/80 hover:bg-ink/5 transition-colors cursor-pointer disabled:opacity-50 text-[11px]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setCreating(false); setName(''); }}
            className="px-2 py-1 rounded-md text-ink/50 hover:text-ink cursor-pointer text-[11px]"
          >
            Cancel
          </button>
        </div>
      )}

      {confirmDelete && selectedPreset && (
        <div className="flex items-center gap-2 pt-2 text-[11px] text-ink/70">
          <span>Delete “{selectedPreset.name}”? The roles themselves are untouched.</span>
          <button
            type="button"
            onClick={() => { setConfirmDelete(false); onDelete(); }}
            disabled={busy}
            className="px-2 py-1 rounded-md border border-error/40 text-error hover:bg-error/10 transition-colors cursor-pointer disabled:opacity-50"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(false)}
            className="px-2 py-1 rounded-md text-ink/50 hover:text-ink cursor-pointer"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
