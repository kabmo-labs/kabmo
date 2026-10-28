/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Behavior-rules → native OMP approval mapping. Parses simple line-based
 * directives from the freeform behavior editor and persists them into
 * ~/.omp/agent/config.yml tools.approval.* with an atomic read-modify-write,
 * preserving all other keys (same technique as roles.ts).
 *
 * Values must be omp's ApprovalPolicy — `allow | deny | prompt`. Anything else
 * is dropped silently by normalizePolicy, which is how `ask` became a no-op.
 * Field names must be real omp tool names, since `tools.approval.<key>` is only
 * consulted when the key matches the tool's `policyKey`.
 *
 * omp honours these per-tool overrides ahead of the approval mode in every
 * mode, so a blanket "allow everything" belongs in tools.approvalMode (the
 * composer's access control), not here.
 */

import { withOmpYamlDocument } from '@/server/lib/omp/config/document';
import { getOmpConfigPath } from '@/server/lib/omp/config/yaml';
import { isRecord } from '@/shared/lib/util/guards';

export type ApprovalValue = 'allow' | 'deny' | 'prompt';

export interface ApprovalFields {
  bash?: ApprovalValue;
  read?: ApprovalValue;
  edit?: ApprovalValue;
  write?: ApprovalValue;
  web_search?: ApprovalValue;
}

interface Directive {
  pattern: RegExp;
  field: keyof ApprovalFields;
  value: ApprovalValue;
}

const SUBJECTS: Array<{ fields: Array<keyof ApprovalFields>; subject: string }> = [
  { fields: ['bash'], subject: 'bash|shell|terminal(?:\\s+commands)?' },
  { fields: ['read'], subject: '(?:safe\\s+)?(?:reads?|read[- ]?only(?:\\s+commands)?)' },
  // One phrasing governs both: the editor has no way to tell a patch from a
  // new file, and leaving `write` uncovered let a "writes" rule miss it.
  { fields: ['edit', 'write'], subject: 'edits?|writes?|patches?' },
  { fields: ['web_search'], subject: 'web(?:\\s*search)?|http|network' },
];

/** "ask" stays a valid phrasing but maps to omp's real `prompt` value. */
const VERBS: Array<{ value: ApprovalValue; verb: string }> = [
  { value: 'allow', verb: 'auto[- ]?approve|allow' },
  { value: 'deny', verb: 'deny|block|forbid' },
  { value: 'prompt', verb: 'ask|prompt|confirm' },
];

// Ordered directives — first matching line for a field wins.
const DIRECTIVES: Directive[] = SUBJECTS.flatMap(({ fields, subject }) =>
  fields.flatMap((field) =>
    VERBS.map(({ value, verb }) => ({
      field,
      value,
      pattern: new RegExp(`^\\s*(?:${verb})\\s+(?:(?:before|for)\\s+)?(?:${subject})\\s*$`, 'i'),
    })),
  ),
);

/**
 * Parse freeform behavior rules into native approval fields. Returns null
 * when no recognizable directive is found (nothing to write natively).
 */
export function parseApprovalRules(text: string): ApprovalFields | null {
  const fields: ApprovalFields = {};
  for (const line of text.split(/\r?\n/)) {
    for (const directive of DIRECTIVES) {
      if (fields[directive.field] === undefined && directive.pattern.test(line)) {
        fields[directive.field] = directive.value;
      }
    }
  }
  return Object.keys(fields).length > 0 ? fields : null;
}

/**
 * Merge approval fields into config.yml tools.approval atomically. Only the
 * parsed fields are touched; unrelated keys are preserved. Throws on invalid
 * YAML — callers should treat this as best-effort.
 */
export async function writeToolsApproval(fields: ApprovalFields): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const path = getOmpConfigPath();
  await withOmpYamlDocument(path, (doc) => {
    const tools = doc.get('tools');
    if (tools !== undefined && !isRecord(tools)) {
      throw new Error(`${path} tools section must be a mapping`);
    }
    const approval = isRecord(tools) ? tools.approval : undefined;
    if (approval !== undefined && !isRecord(approval)) {
      throw new Error(`${path} tools.approval must be a mapping`);
    }
    // Assign through the document so comments on untouched keys survive; a
    // plain object replacement would drop the whole subtree's annotations.
    if (isRecord(tools) && isRecord(approval)) {
      for (const [key, value] of Object.entries(fields)) doc.setIn(['tools', 'approval', key], value);
    } else if (isRecord(tools)) {
      doc.setIn(['tools', 'approval'], fields);
    } else {
      doc.set('tools', { approval: fields });
    }
    return { result: undefined, changed: true };
  });
}
