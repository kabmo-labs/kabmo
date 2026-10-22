/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One role row: the role's name, its id, and a MODEL PICKER.
 *
 * A `<select>` grouped by provider rather than a text field or a hand-rolled
 * popup: the value is a `provider/model` selector, which a user cannot be
 * expected to type correctly (and a typo in `modelRoles` is a role that
 * silently falls back), while a native select gives type-ahead, keyboard
 * navigation and screen-reader semantics for free. The candidates come from
 * omp's own catalog, so a row can only name a model omp can resolve.
 *
 * The current value is always present as an option, even when the catalog no
 * longer lists it (a model removed from models.yml, a provider whose credential
 * was removed, a catalog read that failed): dropping it would make the select
 * show a different model than the config holds, and the next edit would write
 * that one over it.
 */

import type { ModelRoleCandidate } from '@/shared/types/model-roles';
import type { ModelRoleInfo } from '@/shared/lib/omp/config/model-roles';

interface RoleRowProps {
  role: string;
  info: ModelRoleInfo;
  value: string;
  candidates: ModelRoleCandidate[];
  disabled: boolean;
  onChange: (role: string, value: string) => void;
}

/** Candidates grouped by provider, in the order they arrive (already sorted). */
function groupByProvider(candidates: ModelRoleCandidate[]): Array<{ provider: string; rows: ModelRoleCandidate[] }> {
  const groups: Array<{ provider: string; rows: ModelRoleCandidate[] }> = [];
  for (const candidate of candidates) {
    const last = groups[groups.length - 1];
    if (last && last.provider === candidate.provider) last.rows.push(candidate);
    else groups.push({ provider: candidate.provider, rows: [candidate] });
  }
  return groups;
}

export function RoleRow({ role, info, value, candidates, disabled, onChange }: RoleRowProps) {
  const known = candidates.some((candidate) => candidate.selector === value);
  const groups = groupByProvider(candidates);
  const label = `${info.label} (${role}) model`;

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <div className="font-medium text-ink">{info.label}</div>
        <div className="font-mono text-[9px] text-ink/30">{role}</div>
      </div>
      <select
        aria-label={label}
        title={value || 'omp decides this role'}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(role, event.currentTarget.value)}
        className="w-60 max-w-[60%] bg-paper border border-ink/15 rounded-md px-2 py-1 text-ink font-mono text-[11px] cursor-pointer disabled:opacity-50"
      >
        <option value="">— omp default —</option>
        {value && !known && <option value={value}>{value} (not in catalog)</option>}
        {groups.map((group) => (
          <optgroup key={group.provider} label={group.provider}>
            {group.rows.map((candidate) => (
              <option key={candidate.selector} value={candidate.selector}>
                {candidate.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
