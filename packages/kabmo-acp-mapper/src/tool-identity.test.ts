/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A delegation must be RECOGNISED, whichever spelling the adapter uses.
 *
 * Four gaps, each measured against a real agent or a recorded frame:
 *
 *  - grok sends its tool name only in `_meta["x.ai/tool"]`; reading the top
 *    level left `spawn_subagent` unnamed, so the background probe never ran and
 *    the subagent's answer was never surfaced;
 *  - cursor names the tool in `rawInput._toolName` (`"task"`), so `kind:"other"`
 *    alone made a subagent render as a file read;
 *  - an adapter's own kind (`delegate`, `subagent`) was cast to the spec enum
 *    and mapped to `read` instead of staying generic;
 *  - the `task` card's body only knew omp's `input.tasks[]`, so an ACP
 *    delegation drew an EMPTY card.
 */

import { describe, expect, test } from 'bun:test';
import { delegationLabel, normalizeKind, resolveToolIdentity } from './tool-identity';
import { acpDelegationRow } from '@/client/components/workspace/chat-timeline/tool-renderers/panels/task-rows';
import { normalizeAgentEvent } from '@/server/lib/chat/normalize-tools.server';
import { parseMessageBlocks, toToolCallData } from '@kabmo-labs/kabmo-omp-session-parse/parse-message-blocks';
import { toolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

/** The panel the pipeline gives a frame's first call: mapper → server
 *  normalizer → parser → client lookup. The adapter's own fields are not a
 *  renderer contract any more. */
function panelOf(frames: readonly Record<string, unknown>[]): string | null {
  const update = frames.find((frame) => frame.type === 'message_update');
  if (!update) return null;
  const normalized = normalizeAgentEvent(update as { type: string; [key: string]: unknown });
  const message = normalized.message as { content?: unknown } | undefined;
  const call = parseMessageBlocks(message?.content).toolCalls[0];
  return call ? toolPanelKind(toToolCallData(call, { streaming: true })) : null;
}

describe('resolveToolIdentity', () => {
  test('grok names its tool in _meta and keeps the spec kind', () => {
    expect(
      resolveToolIdentity({ title: 'spawn subagent', _meta: { 'x.ai/tool': { name: 'spawn_subagent', kind: 'read' } } }),
    ).toEqual({ name: 'spawn_subagent', kind: 'read' });
  });

  test('cursor names its tool in rawInput._toolName', () => {
    expect(resolveToolIdentity({ title: 'Task: Subagent task', kind: 'other', rawInput: { _toolName: 'task' } })).toEqual({
      name: 'task',
      kind: 'other',
    });
  });

  test('zcode names its tool only in _meta.claudeCode.toolName', () => {
    // The bridge reports `kind:"other"` for a subagent, so without this the
    // card had no panel at all — measured on zcode-acp-server 0.82.3.
    expect(
      resolveToolIdentity({ title: 'audit auth', kind: 'other', _meta: { claudeCode: { toolName: 'Agent' } } }),
    ).toEqual({ name: 'task', kind: 'other' });
  });

  test('qwen names its tool in a flat _meta.toolName', () => {
    // qwen's adapter sends no top-level `name`; `_meta.toolName` is the only
    // identity, and `kind` alone turned `grep_search` into a bare `grep`.
    expect(
      resolveToolIdentity({ title: 'Grep: pattern', kind: 'search', _meta: { toolName: 'grep_search' } }),
    ).toEqual({ name: 'grep', kind: 'search' });
  });

  test('the spec field outranks every _meta spelling', () => {
    expect(
      resolveToolIdentity({
        name: 'Read',
        kind: 'read',
        _meta: { 'x.ai/tool': { name: 'spawn_subagent' }, claudeCode: { toolName: 'Bash' }, toolName: 'shell' },
      }),
    ).toEqual({ name: 'Read', kind: 'read' });
  });

  test('kimi names its tool in the title prefix, with no name and no kind', () => {
    // Measured against kimi-cli's `acp/session.py`: the start frame carries
    // `title = "ToolName: argumen"` and nothing else.
    expect(resolveToolIdentity({ title: 'StrReplaceFile: src/a.ts' })).toEqual({ name: 'edit' });
    expect(resolveToolIdentity({ title: 'SetTodoList' })).toEqual({});
  });

  test('a title is not read while the adapter named or classified the call', () => {
    // codex-acp's file change: `title:"Editing files"`, `kind:"edit"`, no name.
    // The kind is the identity there; the title must not become one.
    expect(resolveToolIdentity({ title: 'Editing files', kind: 'edit' })).toEqual({ kind: 'edit' });
    expect(resolveToolIdentity({ title: 'read: src/a.ts', kind: 'read' })).toEqual({ kind: 'read' });
  });

  test('a title that merely contains a colon is not a tool name', () => {
    expect(resolveToolIdentity({ title: 'https://example.com/a' })).toEqual({});
    expect(resolveToolIdentity({ title: 'C:\\repo\\a.ts' })).toEqual({});
    expect(resolveToolIdentity({ title: 'Reading configuration file' })).toEqual({});
  });

  test('an adapter kind outside the spec becomes other, and is kept', () => {
    expect(normalizeKind('delegate')).toEqual({ kind: 'other', rawKind: 'delegate' });
    expect(normalizeKind('execute')).toEqual({ kind: 'execute' });
    expect(normalizeKind(undefined)).toEqual({});
  });
});

describe('delegationLabel', () => {
  test('grok: description wins, then prompt, then the title', () => {
    expect(delegationLabel('spawn_subagent', { description: 'audit auth' }, 'spawn')).toBe('audit auth');
    expect(delegationLabel('spawn_subagent', { prompt: 'trace the bug' }, 'spawn')).toBe('trace the bug');
    expect(delegationLabel('spawn_subagent', {}, 'spawn')).toBe('spawn');
  });

  test('cursor: the wrapped task is a delegation with the title as its label', () => {
    expect(delegationLabel('task', { _toolName: 'task' }, 'Task: Subagent task')).toBe('Task: Subagent task');
  });

  test('an ordinary tool is not a delegation', () => {
    expect(delegationLabel('bash', { command: 'ls' }, 'ls')).toBeNull();
    expect(delegationLabel('read', undefined, 'read a.ts')).toBeNull();
  });
});

describe('acpDelegationRow', () => {
  test('grok’s child becomes the row the card draws', () => {
    expect(acpDelegationRow({ description: 'audit auth', subagent_type: 'explore' }, undefined)).toEqual({
      name: 'audit auth',
      agent: 'explore',
      task: 'audit auth',
    });
  });

  test('a missing subagent_type is absent, never invented', () => {
    expect(acpDelegationRow({ prompt: 'trace it' }, undefined)).toEqual({ name: 'trace it', task: 'trace it' });
  });

  test('opencode names the child agent in `agent`', () => {
    expect(acpDelegationRow({ description: 'audit auth', prompt: 'check it', agent: 'explore' }, undefined)).toEqual({
      name: 'audit auth',
      agent: 'explore',
      task: 'audit auth',
    });
  });

  test('cursor’s wrapped task falls back to the intent for its label', () => {
    expect(acpDelegationRow({ _toolName: 'task' }, 'Task: Subagent task')).toEqual({ name: 'Task: Subagent task' });
  });

  test('a call with no child is not a delegation', () => {
    expect(acpDelegationRow(undefined, 'ls')).toBeNull();
    expect(acpDelegationRow({ path: 'a.ts' }, 'read')).toBeNull();
  });
});

describe('the card the frames produce', () => {
  test('grok and cursor both land on the task panel with the child named', async () => {
    const { AcpFrameMapper } = await import('./frames');
    const mapper = new AcpFrameMapper();
    mapper.reset();
    const grok = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'g1',
      title: 'spawn subagent',
      status: 'pending',
      rawInput: { description: 'audit auth', subagent_type: 'explore' },
      _meta: { 'x.ai/tool': { name: 'spawn_subagent', kind: 'other' } },
    });
    const start = grok.find((event) => event.type === 'tool_execution_start');
    expect(start).toMatchObject({ toolName: 'spawn_subagent', intent: 'audit auth' });
    const block = grok.find((event) => event.type === 'message_update')?.message as { content: unknown[] };
    expect(block.content).toContainEqual(
      expect.objectContaining({ type: 'toolCall', name: 'spawn_subagent' }),
    );
    // The panel comes from the server normalizer, not from the adapter.
    expect(panelOf(grok)).toBe('task');

    const cursor = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'c1',
      title: 'Task: Subagent task',
      kind: 'other',
      status: 'pending',
      rawInput: { _toolName: 'task' },
    });
    expect(cursor.find((event) => event.type === 'tool_execution_start')).toMatchObject({ toolName: 'task' });
    expect(panelOf(cursor)).toBe('task');
  });

  test('an adapter kind outside the spec stays generic, not a file read', async () => {
    const { AcpFrameMapper } = await import('./frames');
    const mapper = new AcpFrameMapper();
    mapper.reset();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'x1',
      name: 'VendorWidget',
      title: 'VendorWidget — ls',
      kind: 'delegate',
      status: 'pending',
    });
    // No panel: the row renders its JSON fallback instead of a guessed card.
    expect(panelOf(frames)).toBeNull();
  });
});
