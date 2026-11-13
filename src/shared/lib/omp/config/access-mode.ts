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
 *
 * The SAME three words mean something narrower on an ACP harness: there the
 * agent decides which calls it asks about, and Kabmo's tier only decides which
 * of those arrive as a dialog (`acp/permissions.ts`). It can loosen an agent's
 * own gate and never tighten it — so the pick is remembered PER HARNESS, and a
 * `yolo` chosen for omp never silently becomes another agent's auto-approval.
 */

import { isRecord } from '@/shared/lib/util/guards';

export type ApprovalMode = 'always-ask' | 'write' | 'yolo';

export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'always-ask';

export const APPROVAL_MODES: readonly ApprovalMode[] = ['always-ask', 'write', 'yolo'];

/** `app_settings` key the composer persists its pick under. */
export const ACCESS_MODE_SETTING_KEY = 'omp_access_mode';

/** `app_settings` key holding the composer's pick for every OTHER harness. */
export const HARNESS_ACCESS_MODES_SETTING_KEY = 'harness_access_modes';

export function isApprovalMode(value: unknown): value is ApprovalMode {
  return typeof value === 'string' && APPROVAL_MODES.some((mode) => mode === value);
}

export function normalizeApprovalMode(value: unknown): ApprovalMode {
  return isApprovalMode(value) ? value : DEFAULT_APPROVAL_MODE;
}

/**
 * omp's own two transports. Their tier IS omp's approval gate — the spawn flag
 * over RPC, omp's own `tools.approvalMode` over ACP — so they share the global
 * pick the server also reads as its spawn-time default.
 */
export function isOmpHarness(harness: string | null | undefined): boolean {
  return !harness || harness === 'omp-rpc' || harness === 'omp-acp';
}

/** The per-harness picks stored in `app_settings`; an unknown shape reads as none. */
export function readAccessModePicks(settings: Record<string, unknown> | undefined): Record<string, ApprovalMode> {
  const raw = settings?.[HARNESS_ACCESS_MODES_SETTING_KEY];
  if (!isRecord(raw)) return {};
  const picks: Record<string, ApprovalMode> = {};
  for (const [harness, mode] of Object.entries(raw)) {
    if (isApprovalMode(mode)) picks[harness] = mode;
  }
  return picks;
}

/**
 * The tier to show for `harness`.
 *
 * omp's transports fall back to the global pick (`omp_access_mode`), which is
 * also the server's spawn default. Every other harness starts at `always-ask`
 * until the operator picks one FOR IT: carrying omp's `yolo` across a harness
 * switch would auto-approve an agent the operator never granted that.
 */
export function accessModeForHarness(
  harness: string | null | undefined,
  picks: Record<string, ApprovalMode>,
  settings?: Record<string, unknown>,
): ApprovalMode {
  const picked = picks[harness ?? 'omp-rpc'];
  if (isApprovalMode(picked)) return picked;
  return isOmpHarness(harness) ? normalizeApprovalMode(settings?.[ACCESS_MODE_SETTING_KEY]) : DEFAULT_APPROVAL_MODE;
}
