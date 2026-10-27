import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

/**
 * Composer labels for omp's tool-approval modes (see ApprovalMode).
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
