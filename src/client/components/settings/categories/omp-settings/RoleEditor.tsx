/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model role editor — role → model selector overrides in config.yml.
 * Roles come from the native omp schema (`modelRoles` built-in roles), and
 * writes go through /api/model-roles, which edits only `modelRoles` in the
 * global config. Empty input removes the role override.
 *
 * The list is omp's OWN `MODEL_ROLE_IDS` (15 entries at 18.11.0), not a
 * hand-picked subset: the panel used to offer 9, which left `memory`, `image`,
 * `web`, `speech`, `dictation` and `judge` unreachable from the UI even though
 * `omp config set` accepts them and omp reads them at runtime. `dictation` in
 * particular is how a local STT model is chosen (the chamber's own dictation
 * resolves `stt.language` from config; the model comes from this role), so the
 * missing row was the one a non-English user needed most.
 *
 * The two SECTIONS are omp's own (`chat` vs `kind`): the first ten roles each
 * accept a chat model, while `image`/`web`/`speech`/`dictation`/`judge` accept
 * a model of that kind only — a chat model in `judge` is silently unusable, so
 * the split is information the user needs, not decoration.
 */

import { useState } from 'preact/hooks';
import { Check } from 'lucide-preact';

interface RoleInfo {
  /** omp's display name for the role (`MODEL_ROLES[role].name`). */
  label: string;
  /** omp's section: a chat model, or a model of that kind only. */
  section: 'chat' | 'kind';
}

/** omp's `MODEL_ROLES` table, in its own declaration order. */
export const MODEL_ROLES: Record<string, RoleInfo> = {
  default: { label: 'Default', section: 'chat' },
  smol: { label: 'Fast', section: 'chat' },
  slow: { label: 'Thinking', section: 'chat' },
  vision: { label: 'Vision', section: 'chat' },
  plan: { label: 'Architect', section: 'chat' },
  commit: { label: 'Commit', section: 'chat' },
  tiny: { label: 'Tiny', section: 'chat' },
  memory: { label: 'Memory', section: 'chat' },
  task: { label: 'Subtask', section: 'chat' },
  advisor: { label: 'Advisor', section: 'chat' },
  image: { label: 'Image generation', section: 'kind' },
  web: { label: 'Web search', section: 'kind' },
  speech: { label: 'Speech (TTS)', section: 'kind' },
  dictation: { label: 'Dictation (STT)', section: 'kind' },
  judge: { label: 'Judge', section: 'kind' },
};

const ROLE_IDS = Object.keys(MODEL_ROLES);

/** One editable role row. */
function RoleRow({
  role,
  value,
  onCommit,
}: {
  role: string;
  value: string;
  onCommit: (role: string, raw: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const info = MODEL_ROLES[role];
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-medium text-ink">{info.label}</div>
        <div className="font-mono text-[9px] text-ink/30">{role}</div>
      </div>
      <input
        aria-label={`${info.label} (${role}) model`}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => onCommit(role, e.currentTarget.value)}
        placeholder="provider/model"
        className="w-56 bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink text-right font-mono"
      />
    </div>
  );
}

interface RoleEditorProps {
  modelRoles: Record<string, string>;
  onSaveRole: (role: string, value: string) => void;
  savedRole: string | null;
}

export function RoleEditor({ modelRoles, onSaveRole, savedRole }: RoleEditorProps) {
  const commitRole = (role: string, raw: string) => {
    const trimmed = raw.trim();
    if ((modelRoles[role] ?? '') === trimmed) return;
    onSaveRole(role, trimmed);
  };

  const sections: Array<{ id: 'chat' | 'kind'; title: string; note: string }> = [
    {
      id: 'chat',
      title: 'Chat roles',
      note: 'Each takes a chat model. Empty removes the override and omp falls back to its own resolution.',
    },
    {
      id: 'kind',
      title: 'Model-kind roles',
      note: 'Each takes a model of that kind only — a chat model here is silently unusable.',
    },
  ];

  return (
    <div className="pt-2">
      <div className="flex items-center justify-between pb-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">Model Roles</h3>
          <p className="text-ink/50 mt-0.5">Role → model selectors from config.yml. Empty removes the role override.</p>
        </div>
        {savedRole && (
          <span className="inline-flex items-center gap-1 text-[10px] text-ink/60"><Check size={11} /> saved</span>
        )}
      </div>
      {sections.map((section) => {
        const roles = ROLE_IDS.filter((role) => MODEL_ROLES[role].section === section.id);
        return (
          <div key={section.id} className="mb-3">
            <div className="pb-1">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink/50">{section.title}</div>
              <div className="text-[10px] text-ink/40 leading-snug">{section.note}</div>
            </div>
            <div className="rounded-lg border border-ink/10 divide-y divide-ink/5">
              {roles.map((role) => (
                <RoleRow
                  key={role}
                  role={role}
                  value={modelRoles[role] ?? ''}
                  onCommit={commitRole}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
