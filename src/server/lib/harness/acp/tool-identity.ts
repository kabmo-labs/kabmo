/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Who a tool call IS, when the top-level fields do not say.
 *
 * Two ACP agents put the identity somewhere else, and both were rendered as a
 * generic or WRONG tool before this module existed:
 *
 *  - **grok** sends `name` and `kind` only inside `_meta["x.ai/tool"]`. With the
 *    top-level fields absent, a `spawn_subagent` fell back to the title
 *    ("spawn subagent") and the probe for work that outlives the turn never
 *    matched it.
 *  - **cursor** sends the real tool in `rawInput._toolName` (`"task"`), with
 *    `kind:"other"` and a title of "Task: Subagent task". `kind` alone therefore
 *    made a subagent look like a file read.
 *
 * `kind` is the spec's ten-value enum, but adapters invent more (`delegate`,
 * `subagent`). An unknown value becomes `other` with the original kept as
 * `rawKind` — the same rule bb applies — instead of being cast and then mapped
 * to `read`, which is how a delegation drew a file-read panel.
 */

import type { AcpToolKind } from '@/server/lib/harness/acp/protocol';

const KNOWN_KINDS: Readonly<Record<AcpToolKind, true>> = {
  read: true,
  edit: true,
  delete: true,
  move: true,
  search: true,
  execute: true,
  think: true,
  fetch: true,
  switch_mode: true,
  other: true,
};

export interface AcpToolIdentity {
  name?: string;
  kind?: AcpToolKind;
  /** The adapter's own kind, when it is not one of the spec's ten. */
  rawKind?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

/** The `{name, kind}` a vendor `_meta` carries, when it carries one. */
function metaIdentity(update: Record<string, unknown>): AcpToolIdentity {
  const meta = record(update._meta);
  const vendor = meta ? record(meta['x.ai/tool']) : undefined;
  if (!vendor) return {};
  return {
    ...(typeof vendor.name === 'string' && vendor.name ? { name: vendor.name } : {}),
    ...(typeof vendor.kind === 'string' ? { rawKind: vendor.kind } : {}),
  };
}

/** A spec `kind`, or `other` with the adapter's own value kept. */
export function normalizeKind(kind: string | undefined): { kind?: AcpToolKind; rawKind?: string } {
  if (!kind) return {};
  if (kind in KNOWN_KINDS) return { kind: kind as AcpToolKind };
  return { kind: 'other', rawKind: kind };
}

/**
 * The identity of one tool call: the top-level fields, with the vendor `_meta`
 * filling in what they omit and `rawInput._toolName` naming the tool a wrapped
 * adapter hides.
 */
export function resolveToolIdentity(update: Record<string, unknown>): AcpToolIdentity {
  const meta = metaIdentity(update);
  const rawInput = record(update.rawInput);
  const wrapped = typeof rawInput?._toolName === 'string' ? rawInput._toolName : undefined;
  const name = typeof update.name === 'string' && update.name
    ? update.name
    : meta.name ?? wrapped;
  const declared = typeof update.kind === 'string' ? update.kind : meta.rawKind;
  return {
    ...(name ? { name } : {}),
    ...normalizeKind(declared),
  };
}

/** Names that hand work to a process the turn does not await. */
const DELEGATION_NAMES: Readonly<Record<string, true>> = {
  spawn_subagent: true,
  invoke_subagent: true,
  spawn_agent: true,
  delegate: true,
};

/**
 * Whether this call DELEGATES, and the sentence the card shows for it.
 *
 * A delegation is not a file read and not a generic tool: it is a child agent,
 * and Kabmo's `task` panel is what renders one. The label comes from the
 * adapter's own words (`description`, then `prompt`, then the title) because a
 * blank subagent card tells the operator nothing about what it is doing.
 */
export function delegationLabel(
  name: string | undefined,
  rawInput: Record<string, unknown> | undefined,
  title: string | undefined,
): string | null {
  const bare = (name ?? '').toLowerCase();
  const delegates = DELEGATION_NAMES[bare] === true || rawInput?._toolName === 'task';
  if (!delegates) return null;
  const detail = typeof rawInput?.description === 'string' && rawInput.description
    ? rawInput.description
    : typeof rawInput?.prompt === 'string' && rawInput.prompt
      ? rawInput.prompt
      : undefined;
  return detail ?? title ?? 'Subagent';
}
