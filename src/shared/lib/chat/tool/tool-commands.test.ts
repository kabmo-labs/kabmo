/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * omp 19.1.0 runs rarely-used tools as bash TOOL COMMANDS and records each
 * invocation on the result's `details.toolCommands[]`. A card must draw the
 * wrapped tool's own panel when the call IS that invocation — a terminal
 * console over a staged proposal's decision loses the decision — and must not
 * when the line did more than one thing.
 *
 * `isSoleInvocation` mirrors omp's own rule, so the cases below are the ones
 * that change the answer: a pipe, a redirect, a substitution, a compound
 * separator, a background job, or a quoted `$`.
 */

import { describe, expect, test } from 'bun:test';

import {
  isSoleInvocation,
  soleInnerDetails,
  soleToolCommand,
  toolCommandDispatches,
} from '@/shared/lib/chat/tool/tool-commands';
import type { ToolCallData } from '@/shared/types/chat';

function bashCall(command: string, toolCommands: unknown[]): ToolCallData {
  return {
    id: 'call-1',
    type: 'bash',
    title: 'bash',
    name: 'bash',
    input: { command },
    details: { toolCommands },
  } as ToolCallData;
}

const EXECUTE = { tool: 'resolve', mode: 'execute' as const, exitCode: 0, args: { reason: 'looks right' } };

describe('isSoleInvocation', () => {
  test('accepts the bare command and its arguments', () => {
    expect(isSoleInvocation('resolve "looks right"', 'resolve')).toBe(true);
    expect(isSoleInvocation("propose migrate-importer", 'propose')).toBe(true);
    expect(isSoleInvocation('lsp --help', 'lsp')).toBe(true);
  });

  test('rejects a line that runs anything else', () => {
    expect(isSoleInvocation('resolve "x" | tail -1', 'resolve')).toBe(false);
    expect(isSoleInvocation('resolve "x" && git status', 'resolve')).toBe(false);
    expect(isSoleInvocation('resolve "x" > out.txt', 'resolve')).toBe(false);
    expect(isSoleInvocation('echo hi; resolve "x"', 'resolve')).toBe(false);
    expect(isSoleInvocation('resolve "x" &', 'resolve')).toBe(false);
    expect(isSoleInvocation('resolve "$(cat reason)"', 'resolve')).toBe(false);
    expect(isSoleInvocation('resolved "x"', 'resolve')).toBe(false);
  });

  test('a quoted separator or dollar is literal text, not a second command', () => {
    expect(isSoleInvocation('resolve "one; two"', 'resolve')).toBe(true);
    expect(isSoleInvocation("resolve 'a | b'", 'resolve')).toBe(true);
    expect(isSoleInvocation('resolve "costs \\$5"', 'resolve')).toBe(true);
  });
});

describe('toolCommandDispatches', () => {
  test('reads only well-formed records', () => {
    const tool = bashCall('resolve "x"', [EXECUTE, { tool: 'lsp' }, { tool: 'read', mode: 'help', exitCode: 0 }]);
    expect(toolCommandDispatches(tool).map((dispatch) => dispatch.tool)).toEqual(['resolve', 'read']);
  });

  test('a result with no records reports none', () => {
    expect(toolCommandDispatches({ ...bashCall('ls', []), details: {} } as ToolCallData)).toEqual([]);
  });
});

describe('soleToolCommand', () => {
  test('a single execute dispatch whose line is that command is the call', () => {
    const tool = bashCall('resolve "looks right"', [EXECUTE]);
    expect(soleToolCommand(tool)).toEqual({ dispatch: EXECUTE, args: { reason: 'looks right' } });
  });

  test('two dispatches mean a script, not one tool call', () => {
    const tool = bashCall('resolve "x"; lsp diagnostics', [EXECUTE, { tool: 'lsp', mode: 'execute', exitCode: 0 }]);
    expect(soleToolCommand(tool)).toBeUndefined();
  });

  test('a --help run is usage, not a result', () => {
    const tool = bashCall('lsp --help', [{ tool: 'lsp', mode: 'help', exitCode: 0 }]);
    expect(soleToolCommand(tool)).toBeUndefined();
  });

  test('a command line that also pipes is not the tool call', () => {
    const tool = bashCall('resolve "x" | head -2', [EXECUTE]);
    expect(soleToolCommand(tool)).toBeUndefined();
  });

  test('inner details of the wrapped tool are surfaced, and absent otherwise', () => {
    const withInner = bashCall('resolve "x"', [{ ...EXECUTE, inner: { action: 'apply', reason: 'x' } }]);
    expect(soleInnerDetails(withInner)).toEqual({ action: 'apply', reason: 'x' });
    expect(soleInnerDetails(bashCall('resolve "x"', [EXECUTE]))).toBeUndefined();
  });
});
