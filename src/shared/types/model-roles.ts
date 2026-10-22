/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Model-role presets and the candidate catalog behind the role dropdowns.
 *
 * A preset is a NAMED snapshot of omp's `modelRoles` map (`role → selector`),
 * stored in Kabmo's own SQLite table. omp has the same idea upstream
 * (`modelPresets.<name>` in config.yml, driven by `/modelpreset`), but that
 * surface is TUI-only — there is no RPC verb for it and Kabmo does not own the
 * file's `modelPresets` key, so re-implementing it there would mean a second
 * writer on a file omp rewrites. The preset is Kabmo's record; APPLYING one
 * writes `modelRoles` through the same writer the role rows already use.
 */

/** One stored preset: a whole `modelRoles` map under a name. */
export interface ModelRolePreset {
  id: string;
  name: string;
  /** `role → model selector` (`provider/model`), exactly what config.yml holds. */
  roles: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

/**
 * One row of omp's model catalog, shaped for a role dropdown.
 *
 * `kind` is omp's catalog kind (`chat`, `tiny`, `search`, `stt`, `tts`,
 * `image`, `judge`, …). `webCapable` is set for CHAT models that declare a
 * grounding transport — omp's `web` role accepts those as well as `search`
 * models, and the catalog JSON does not carry that flag.
 */
export interface ModelRoleCandidate {
  /** `provider/id` — the selector a role row stores. */
  selector: string;
  id: string;
  name: string;
  provider: string;
  kind: string;
  webCapable?: boolean;
}

/** `GET /api/model-roles` payload. */
export interface ModelRolesPayload {
  path?: string;
  roles: Record<string, string>;
  presets: ModelRolePreset[];
  candidates: ModelRoleCandidate[];
  /** Why the catalog could not be read (omp missing, CLI failure); roles still render. */
  candidatesError?: string | null;
}
