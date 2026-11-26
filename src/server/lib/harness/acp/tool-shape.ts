/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The SHAPES one ACP tool call is reported in, split from the accumulator that
 * sequences them.
 *
 * `tool-calls.ts` owns the lifecycle (create on first sight, patch afterwards,
 * close on a final status). What is here is the per-frame translation, because
 * each function exists for a measured adapter quirk rather than for the
 * lifecycle:
 *
 *  - `toolArgs` — `rawInput` is a bare object, but the field is `unknown`;
 *  - `blockOf` — the card the timeline renders, built from accumulated fields
 *    so a patch can replace it in place;
 *  - `terminalMeta` — pi-acp reports a shell result ONLY as
 *    `_meta.terminal_output.data` + `_meta.terminal_exit.exit_code`;
 *  - `KIND_TOOL_NAME` — codex-acp's file change arrives with no name at all.
 */

import { isRecord } from '@kabmo-labs/kabmo-guards';
import type { AcpToolKind } from '@/server/lib/harness/acp/protocol';

/** The message block a tool card renders from. */
export interface ToolCallBlock {
  type: 'toolCall';
  id: string;
  name: string;
  /** The adapter's own label. It is a classification INPUT: an adapter that
   *  sends `title:"Run Command"` and no name has no other identity. */
  title?: string;
  arguments?: Record<string, unknown>;
  toolKind?: AcpToolKind;
  /** The adapter's own kind, when it is not one of the spec's ten. */
  rawKind?: string;
}

/** The tool name a call takes when the adapter sent none but DID send a kind.
 *  `other`/`switch_mode` are absent on purpose: they name no operation, and a
 *  plan-mode toggle must not be drawn as a todo list. */
export const KIND_TOOL_NAME: Partial<Record<AcpToolKind, string>> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  search: 'grep',
  execute: 'bash',
  fetch: 'web_search',
  think: 'think',
};

/** The object form of `rawInput`, or undefined for an absent/non-object one. */
export function toolArgs(rawInput: unknown): Record<string, unknown> | undefined {
  return isRecord(rawInput) ? Object.fromEntries(Object.entries(rawInput)) : undefined;
}

/**
 * The command facts an adapter sends in `_meta` instead of the result.
 *
 * `pi-acp` reports a shell result ONLY this way: its `tool_call` carries
 * `_meta.terminal_info` and a `{type:"terminal"}` content block, and its
 * `tool_call_update` carries `_meta.terminal_output.data` plus
 * `_meta.terminal_exit.exit_code` — no text content at all, because it expects
 * the client to own a terminal. Kabmo advertises no terminal, so without this
 * the card had a title and an empty body.
 */
export function terminalMeta(meta: unknown): { output?: string; exitCode?: number } {
  if (!isRecord(meta)) return {};
  const output = isRecord(meta.terminal_output) && typeof meta.terminal_output.data === 'string'
    ? meta.terminal_output.data
    : undefined;
  const exit = isRecord(meta.terminal_exit) && typeof meta.terminal_exit.exit_code === 'number'
    ? meta.terminal_exit.exit_code
    : undefined;
  return {
    ...(output ? { output } : {}),
    ...(exit !== undefined ? { exitCode: exit } : {}),
  };
}

/** The message block a card draws from the call's accumulated fields. */
export function blockOf(call: {
  id: string;
  name: string;
  title?: string;
  kind?: AcpToolKind;
  args?: Record<string, unknown>;
  rawKind?: string;
}): ToolCallBlock {
  return {
    type: 'toolCall',
    id: call.id,
    name: call.name,
    ...(call.title ? { title: call.title } : {}),
    ...(call.args ? { arguments: call.args } : {}),
    ...(call.kind ? { toolKind: call.kind } : {}),
    ...(call.rawKind ? { rawKind: call.rawKind } : {}),
  };
}
