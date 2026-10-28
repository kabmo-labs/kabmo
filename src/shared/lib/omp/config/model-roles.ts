/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp's built-in model roles, and which catalog kinds each one accepts.
 *
 * One table, read by the role editor (labels + sections), by the role dropdowns
 * (which models to offer) and by the server (which role ids a preset may hold).
 * It mirrors `MODEL_ROLES` in `@oh-my-pi/pi-coding-agent/src/config/model-roles.ts`
 * — the `accepts` predicates are flattened into `kinds` so the same rule can run
 * on a catalog row that has no `Model` object.
 *
 * `kinds` is a CATALOG-kind list, and the predicates upstream are not all
 * expressible that way: `web` also accepts chat models that declare a grounding
 * transport (`webSearch`), which the catalog JSON does not carry. Those rows are
 * marked `webCapable` by the server and admitted by
 * {@link roleAcceptsCandidate} — the one predicate both the UI and the tests use.
 *
 * `widget` ("Job widgets") exists at omp 18.12.6 and was missing from this
 * panel, which made it the only role a user could not set from the console.
 */

import type { ModelRoleCandidate } from '@/shared/types/model-roles';

export interface ModelRoleInfo {
  /** omp's display name for the role (`MODEL_ROLES[role].name`). */
  label: string;
  /** omp's section: a chat model, or a model of that kind only. */
  section: 'chat' | 'kind';
  /** Catalog kinds this role accepts. */
  kinds: readonly string[];
}

/** omp's `MODEL_ROLES` table, in its own declaration order. */
export const MODEL_ROLES: Record<string, ModelRoleInfo> = {
  default: { label: 'Default', section: 'chat', kinds: ['chat'] },
  smol: { label: 'Fast', section: 'chat', kinds: ['chat'] },
  slow: { label: 'Thinking', section: 'chat', kinds: ['chat'] },
  vision: { label: 'Vision', section: 'chat', kinds: ['chat'] },
  plan: { label: 'Architect', section: 'chat', kinds: ['chat'] },
  commit: { label: 'Commit', section: 'chat', kinds: ['chat'] },
  tiny: { label: 'Tiny', section: 'chat', kinds: ['tiny', 'chat'] },
  memory: { label: 'Memory', section: 'chat', kinds: ['tiny', 'chat'] },
  task: { label: 'Subtask', section: 'chat', kinds: ['chat'] },
  advisor: { label: 'Advisor', section: 'chat', kinds: ['chat'] },
  widget: { label: 'Job widgets', section: 'chat', kinds: ['chat'] },
  image: { label: 'Image generation', section: 'kind', kinds: ['image'] },
  web: { label: 'Web search', section: 'kind', kinds: ['search'] },
  speech: { label: 'Speech (TTS)', section: 'kind', kinds: ['tts'] },
  dictation: { label: 'Dictation (STT)', section: 'kind', kinds: ['stt'] },
  judge: { label: 'Judge', section: 'kind', kinds: ['judge', 'tiny', 'chat'] },
};

/** Role ids in omp's declaration order. */
export const ROLE_IDS: string[] = Object.keys(MODEL_ROLES);

/** Whether `role` is one of omp's built-in roles. */
export function isModelRole(role: string): boolean {
  return Object.prototype.hasOwnProperty.call(MODEL_ROLES, role);
}

/**
 * Whether a catalog row can fill `role`.
 *
 * `web` is the only role whose upstream predicate needs a field the catalog
 * JSON omits, so its chat rows are admitted through `webCapable` — a search
 * provider is admitted by kind alone.
 */
export function roleAcceptsCandidate(role: string, candidate: ModelRoleCandidate): boolean {
  const info = MODEL_ROLES[role];
  if (!info) return false;
  if (info.kinds.includes(candidate.kind)) return true;
  return role === 'web' && candidate.kind === 'chat' && candidate.webCapable === true;
}

/** Role ids: a letter, then letters, digits, `-` or `_` (omp's own role-name rule). */
const ROLE_ID_PATTERN = /^[a-zA-Z][\w-]*$/;

/**
 * Validate a `modelRoles` map from a request.
 *
 * The keys are NOT narrowed to omp's built-ins: `modelRoles` accepts custom role
 * ids and omp adds them to its own role list, so a filtered copy would silently
 * delete a custom role the moment a preset was applied (the map is written
 * whole). A key that cannot be a role name, or an empty selector, is dropped —
 * those are typos, not assignments.
 */
export function normalizeRoleMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('roles must be a role → model selector map');
  }
  const roles: Record<string, string> = {};
  for (const [role, value] of Object.entries(raw)) {
    if (!ROLE_ID_PATTERN.test(role)) continue;
    if (typeof value !== 'string' || !value.trim()) continue;
    roles[role] = value.trim();
  }
  return roles;
}

/** Candidates for one role, ordered by provider then display name. */
export function candidatesForRole(role: string, candidates: readonly ModelRoleCandidate[]): ModelRoleCandidate[] {
  return candidates
    .filter((candidate) => roleAcceptsCandidate(role, candidate))
    .sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));
}

/** Two `modelRoles` maps hold the same assignments (order-insensitive). */
export function roleMapsEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => b[key] === a[key]);
}

/**
 * The preset whose assignments ARE the live map, or null.
 *
 * This is how the picker says which preset is in force: not a stored "last
 * applied" flag, which goes stale the moment a role is edited by hand — the map
 * itself is the state, and a preset matches when it equals it exactly.
 */
export function matchPreset<T extends { roles: Record<string, string> }>(
  presets: readonly T[],
  roles: Record<string, string>,
): T | null {
  return presets.find((preset) => roleMapsEqual(preset.roles, roles)) ?? null;
}
