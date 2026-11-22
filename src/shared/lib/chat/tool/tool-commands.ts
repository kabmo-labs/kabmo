/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A tool call that ran as a bash TOOL COMMAND (omp 19.1.0).
 *
 * omp replaced its `xd://` devices with tool commands: rarely-used tools are
 * unmounted from the request and installed as bare commands of the embedded
 * shell, so the model runs `resolve "reason"` or `lsp --help` through `bash`
 * instead of writing to a virtual URL. Each invocation is recorded on the
 * result's `details.toolCommands[]` — `{tool, mode, exitCode, args?, inner?}` —
 * and the wrapped tool's own `details` ride `inner`.
 *
 * Two things a card needs from that:
 *
 *  - `sole`: the bash call IS that tool's call, with no other command on the
 *    line. Then the card must draw the tool's own panel (`Resolve`, `Lsp`)
 *    instead of a terminal console, exactly as omp's own transcript does.
 *  - `dispatch`: the record itself, for a call that ran alongside other
 *    commands (a real shell script that happened to invoke one).
 *
 * The `sole` rule mirrors omp's `isSoleInvocation`: the line starts with the
 * tool word, and nothing that would change what ran (a pipe, a redirect, a
 * substitution, a background job, a compound separator) appears outside quotes.
 */

import type { ToolCallData } from '@/shared/types/chat';

/** One record of `details.toolCommands`. */
export interface ToolCommandDispatch {
  tool: string;
  mode: 'help' | 'execute';
  exitCode: number;
  args?: Record<string, unknown>;
  inner?: unknown;
}

/** Characters that make a shell line more than one bare command. */
const COMPOUND: Record<string, true> = {
  ';': true, '&': true, '|': true, '<': true, '>': true,
  '(': true, ')': true, '\n': true, '\r': true,
};

/** True when `command` is exactly one invocation of `tool`. */
export function isSoleInvocation(command: string | undefined, tool: string): boolean {
  const line = command?.trim();
  if (!line) return false;
  if (line !== tool && !line.startsWith(`${tool} `) && !line.startsWith(`${tool}\t`)) return false;
  let quote: '"' | "'" | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] as string;
    if (quote === "'") {
      if (char === "'") quote = undefined;
      continue;
    }
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (quote === '"') {
      if (char === '"') quote = undefined;
      // A substitution inside double quotes still runs something else.
      else if (char === '$' || char === '`') return false;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (COMPOUND[char] === true) return false;
  }
  return true;
}

function isDispatch(value: unknown): value is ToolCommandDispatch {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tool === 'string' &&
    (record.mode === 'help' || record.mode === 'execute') &&
    typeof record.exitCode === 'number'
  );
}

/** Every tool-command dispatch recorded on a result, in invocation order. */
export function toolCommandDispatches(tool: ToolCallData): ToolCommandDispatch[] {
  const raw = (tool.details as Record<string, unknown> | undefined)?.toolCommands;
  if (!Array.isArray(raw)) return [];
  return raw.filter(isDispatch);
}

/** The tool call's own command, from its arguments. */
function commandOf(tool: ToolCallData): string | undefined {
  const input = tool.input;
  if (typeof input === 'string') return input;
  if (input && typeof input === 'object' && typeof (input as Record<string, unknown>).command === 'string') {
    return (input as Record<string, unknown>).command as string;
  }
  return typeof tool.command === 'string' ? tool.command : undefined;
}

/**
 * The tool command this call IS, or undefined.
 *
 * `sole` is the case a card must render as the wrapped tool: one execute
 * dispatch whose command line is that invocation and nothing else. A `--help`
 * dispatch is not one — it printed usage, not a result.
 */
export function soleToolCommand(
  tool: ToolCallData,
): { dispatch: ToolCommandDispatch; args: Record<string, unknown> } | undefined {
  const dispatches = toolCommandDispatches(tool);
  if (dispatches.length !== 1) return undefined;
  const dispatch = dispatches[0];
  if (dispatch.mode !== 'execute') return undefined;
  if (!isSoleInvocation(commandOf(tool), dispatch.tool)) return undefined;
  return { dispatch, args: dispatch.args ?? {} };
}

/** The wrapped tool's own result details of a sole dispatch (`dispatch.inner`). */
export function soleInnerDetails(tool: ToolCallData): Record<string, unknown> | undefined {
  const sole = soleToolCommand(tool);
  const inner = sole?.dispatch.inner;
  return inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : undefined;
}
