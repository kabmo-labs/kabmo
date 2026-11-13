import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';
import { isOmpHarness } from '@/shared/lib/omp/config/access-mode';

/**
 * Composer labels for the tool-approval tiers (see ApprovalMode).
 *
 * The `yolo` copy is deliberately not "Everything runs without asking": omp
 * 18.13.1 added `tools.restrictedFolders`, and a folder on that list asks in
 * EVERY approval mode — `yolo` included — with no remembered grant and no
 * session approval covering it. A mode picker that promised an unconditional
 * bypass would be lying about the mode it names, and the user would meet the
 * gate with no expectation of one.
 */
export const ACCESS_LEVEL_LABELS: Record<ApprovalMode, string> = {
  'always-ask': 'Always ask',
  write: 'Minimal',
  yolo: 'Full bypass',
};

export const ACCESS_LEVEL_DESCRIPTIONS: Record<ApprovalMode, string> = {
  'always-ask': 'Read-only tools run automatically; writes and shell commands ask first.',
  write: 'Reads and edits run automatically; shell commands ask first.',
  yolo: 'Everything runs without asking — except a restricted folder, which always asks.',
};

/**
 * The same three tiers on an agent that is NOT omp.
 *
 * There the tier is not a gate: the agent decides which calls it asks about
 * (`session/request_permission`), and Kabmo only decides which of those arrive
 * as a dialog. It can loosen the agent's own policy and never tighten it, and
 * omp's `tools.restrictedFolders` rule does not exist — so the omp copy would
 * promise a gate this transport cannot raise.
 */
const ACP_ACCESS_LEVEL_DESCRIPTIONS: Record<ApprovalMode, string> = {
  'always-ask': 'Read-only calls are approved automatically; the agent’s writes and commands come to you.',
  write: 'Reads and edits are approved automatically; the agent’s commands come to you.',
  yolo: 'Every approval the agent asks for is granted automatically.',
};

export interface AccessLevelCopy {
  labels: Record<ApprovalMode, string>;
  descriptions: Record<ApprovalMode, string>;
  /**
   * What this transport's tier can and cannot decide, shown under the list.
   * Absent for omp, whose tier IS the gate.
   */
  note?: string;
}

/** The copy for the harness the composer is about to run (or is running). */
export function accessLevelCopy(harness?: string | null): AccessLevelCopy {
  if (isOmpHarness(harness)) {
    return { labels: ACCESS_LEVEL_LABELS, descriptions: ACCESS_LEVEL_DESCRIPTIONS };
  }
  return {
    labels: ACCESS_LEVEL_LABELS,
    descriptions: ACP_ACCESS_LEVEL_DESCRIPTIONS,
    note: 'This agent decides which calls it asks about; the pick answers those requests.',
  };
}
