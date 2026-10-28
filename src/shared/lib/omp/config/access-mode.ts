/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool-approval ("access") mode for a spawned omp process. Client-safe: this
 * module must not import anything server-only, because the composer reads the
 * type/constants in the browser while the route reads them server-side.
 *
 * omp's contract (pi-coding-agent ApprovalMode): `always-ask` auto-runs
 * read-tier tools and prompts for write+exec, `write` auto-runs read+write and
 * prompts for exec, `yolo` auto-runs everything.
 */

export type ApprovalMode = 'always-ask' | 'write' | 'yolo';

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'always-ask';

export const APPROVAL_MODES: readonly ApprovalMode[] = ['always-ask', 'write', 'yolo'];

/** `app_settings` key the composer persists its pick under. */
export const ACCESS_MODE_SETTING_KEY = 'omp_access_mode';

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && APPROVAL_MODES.some((mode) => mode === value);
}

export function normalizeApprovalMode(value: unknown): ApprovalMode {
  return isApprovalMode(value) ? value : DEFAULT_APPROVAL_MODE;
}
