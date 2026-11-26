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
 *  - **zcode** names the call only in `_meta.claudeCode.toolName`, and **qwen**
 *    only in a flat `_meta.toolName`; both were left to `kind`, so `Agent`
 *    (`kind:"other"`) drew no card at all.
 *  - **kimi** sends NEITHER `name` nor `kind`: the tool is the prefix of
 *    `title` (`"StrReplaceFile: src/a.ts"`), and the only other field is the
 *    streamed arguments in `content`.
 *
 * ACP only says an agent SHOULD report `name`, so the identity has to be
 * recovered from every place a measured adapter puts it. The order is
 * deliberate: the spec field first, then the vendor `_meta` keys (grok, zcode,
 * qwen), then the wrapped name cursor hides, and finally the title prefix —
 * which is read ONLY when both `name` and `kind` are absent, because a title is
 * display copy that may merely look like a tool name.
 *
 * `kind` is the spec's ten-value enum, but adapters invent more (`delegate`,
 * `subagent`). An unknown value becomes `other` with the original kept as
 * `rawKind` — the same rule bb applies — instead of being cast and then mapped
 * to `read`, which is how a delegation drew a file-read panel.
 */

import { canonicalAgentToolName } from '@kabmo-labs/kabmo-chat-tool/tool-aliases';
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

/**
 * The `{name, kind}` a vendor `_meta` carries, when it carries one.
 *
 * Three measured spellings, in the order they win:
 *  - `_meta["x.ai/tool"] = {name, kind}` — grok, which sends NO top-level name;
 *  - `_meta.claudeCode.toolName` — zcode's bridge (and claude, which also sends
 *    the name at the top level, so this only fills in for the bridge);
 *  - a flat `_meta.toolName` — qwen, whose whole identity is that key.
 *
 * `kind` is only read from the grok envelope: the other two carry a name only,
 * and inventing a kind from it would duplicate the alias table.
 */
function metaIdentity(update: Record<string, unknown>): AcpToolIdentity {
  const meta = record(update._meta);
  if (!meta) return {};
  const vendor = record(meta['x.ai/tool']);
  const claudeCode = record(meta.claudeCode);
  const flat = typeof meta.toolName === 'string' && meta.toolName ? meta.toolName : undefined;
  const name = typeof vendor?.name === 'string' && vendor.name
    ? vendor.name
    : typeof claudeCode?.toolName === 'string' && claudeCode.toolName
      ? claudeCode.toolName
      : flat;
  return {
    ...(name ? { name } : {}),
    ...(typeof vendor?.kind === 'string' ? { rawKind: vendor.kind } : {}),
  };
}

/**
 * The tool a title names as `<tool>: <subject>`, or undefined.
 *
 * kimi's adapter reports `title = "ToolName: argumen"` and nothing else. The
 * pattern demands a space after the colon, so a title that merely CONTAINS a
 * colon — a URL (`https://…`), a Windows path (`C:\…`), prose — yields nothing.
 */
function titleIdentity(title: unknown): string | undefined {
  if (typeof title !== 'string') return undefined;
  const match = /^([A-Za-z_][\w.-]*):\s/.exec(title);
  return match?.[1];
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
  const declared = typeof update.kind === 'string' ? update.kind : meta.rawKind;
  // The title is display copy, so its `<tool>:` prefix is the LAST resort and
  // only when nothing else names the call — an adapter that sends a name never
  // has its name overridden by the wording of a title.
  const named = (typeof update.name === 'string' && update.name)
    || meta.name
    || wrapped
    || (declared ? undefined : titleIdentity(update.title));
  // An adapter names its tools in its own vocabulary (`shell`, `todowrite`,
  // `webfetch`). Every panel lookup reads the NAME first, so the canonical key
  // is what makes the card a bash/todo/web_search card instead of a generic
  // body — see `AGENT_TOOL_ALIASES` for the measured names.
  const canonical = canonicalAgentToolName(named);
  return {
    ...(canonical ? { name: canonical } : {}),
    ...normalizeKind(declared),
  };
}

/** Names that hand work to a process the turn does not await. */
const DELEGATION_NAMES: Readonly<Record<string, true>> = {
  spawn_subagent: true,
  invoke_subagent: true,
  spawn_agent: true,
  delegate: true,
  // The canonical key after `AGENT_TOOL_ALIASES` (opencode's `subagent`) and
  // omp's own delegation tool. Without it a child agent fell through to the
  // generic body and the card could not say what the child was asked to do.
  task: true,
  subagent: true,
  agent: true,
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
