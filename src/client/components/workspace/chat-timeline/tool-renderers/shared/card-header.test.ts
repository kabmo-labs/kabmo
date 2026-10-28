/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What a tool card's header says.
 *
 * The naming rules were a chain of `else if` inside the card; they are a pure
 * function now, which is what makes them testable at all. The cases below are
 * the shapes omp actually sends — a device call whose target is the only name
 * it has, an `eval` that labels itself, an MCP call whose transport is `write`,
 * a `task` whose subagent lives in `tasks[0]`.
 *
 * One rule runs through all of them: a subtitle is never a raw `xd://` URL. The
 * device names the action; the URL is transport, and showing it told the reader
 * nothing about what the call did.
 */

import { describe, expect, test } from 'bun:test';
import { toolCardHeader, toolCardSubtitle } from '@/client/components/workspace/chat-timeline/tool-renderers/shared/card-header';
import { resolveToolKey } from '@/client/components/workspace/chat-timeline/tool-renderers';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

/** Header as the card computes it: key first, then the naming rules. */
function header(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>) {
  const call = tool(partial);
  return toolCardHeader(call, resolveToolKey(call));
}

describe('toolCardHeader — device calls', () => {
  test('an LSP call names the action and the file it ran against', () => {
    expect(header({
      type: 'write',
      details: { xdev: { tool: 'lsp', args: { action: 'diagnostics', file: 'src/x.ts' } } },
    })).toEqual({ title: 'LSP', subtitle: 'diagnostics · src/x.ts' });
  });

  test('an AST edit names the first path it touched', () => {
    expect(header({
      type: 'write',
      details: { xdev: { tool: 'ast_edit', args: { paths: ['src/a.ts', 'src/b.ts'] } } },
    })).toEqual({ title: 'AST Edit', subtitle: 'src/a.ts' });
  });

  test('a resolve proposal is titled by the verdict, not the transport', () => {
    expect(header({ type: 'write', target: 'xd://resolve' }).title).toBe('Resolve Proposal');
    expect(header({ type: 'write', target: 'xd://reject' }).title).toBe('Reject Proposal');
  });
});

describe('toolCardHeader — self-naming tools', () => {
  test('an eval uses omp’s own label for the cell', () => {
    expect(header({ type: 'eval', input: { title: 'open app and locate composer' } }))
      .toEqual({ title: 'open app and locate composer', subtitle: undefined });
  });

  test('a todo call is titled Todo, with its progress left to the summary chips', () => {
    // Progress is a FACT (`details.phases`), rendered by `toolSummary` — the
    // same source the Todo panel reads. Repeating it in the subtitle made two
    // readers of one quantity that could disagree.
    expect(header({ type: 'todo' })).toEqual({ title: 'Todo' });
  });

  test('an ask call says how many questions it asked', () => {
    expect(header({
      type: 'ask',
      input: { questions: [{ header: 'Pick one', question: 'Which?' }] },
    })).toEqual({ title: 'Question', subtitle: 'Asked 1 question' });
  });
});

describe('toolCardHeader — MCP calls', () => {
  test('the tool names the action, never the transport `write`', () => {
    expect(header({
      type: 'write',
      target: 'xd://mcp__codegraph_explore',
      input: { path: 'xd://mcp__codegraph_explore', content: '{"query":"tool renderers"}' },
    })).toEqual({ title: 'Codegraph Explore', subtitle: 'tool renderers' });
  });

  test('falls back to the first meaningful argument when there is no intent', () => {
    expect(header({
      type: 'write',
      target: 'xd://mcp__codegraph_node',
      input: { path: 'xd://mcp__codegraph_node', content: '{"symbol":"ToolCardShell"}' },
    }).subtitle).toBe('ToolCardShell');
  });
});

describe('toolCardHeader — proc:// calls', () => {
  test('a service stop names the op and the process, not the transport write', () => {
    expect(header({
      type: 'write',
      target: 'proc://kabmo-dev/kill',
      input: { path: 'proc://kabmo-dev/kill', content: null },
      details: { proc: { action: 'stop', daemon: { name: 'kabmo-dev', state: 'exited' } } },
    })).toEqual({ title: 'Proc', subtitle: 'stop · kabmo-dev' });
  });

  test('a status read names the op from the path', () => {
    expect(header({
      type: 'read',
      target: 'proc://ompdev',
      input: { path: 'proc://ompdev' },
      details: { proc: { daemon: { name: 'ompdev', state: 'failed' } } },
    })).toEqual({ title: 'Proc', subtitle: 'list · ompdev' });
  });

  test('a stdin write names the process it wrote to', () => {
    expect(header({
      type: 'write',
      target: 'proc://kabmo-dev',
      input: { path: 'proc://kabmo-dev', content: 'x' },
      details: { proc: { action: 'stdin', daemon: { name: 'kabmo-dev', state: 'ready' } } },
    })).toEqual({ title: 'Proc', subtitle: 'stdin · kabmo-dev' });
  });

  test('the bare listing names the operation and no process', () => {
    expect(header({ type: 'read', target: 'proc://', input: { path: 'proc://' } }))
      .toEqual({ title: 'Proc', subtitle: 'list' });
  });

  test('a plain file read keeps the Read title', () => {
    expect(header({ type: 'read', target: 'src/x.ts', input: { path: 'src/x.ts' } }).title).toBe('Read');
  });
});

describe('toolCardHeader — read xd:// docs', () => {
  test('names the URL it read, which is the whole identity', () => {
    expect(header({
      type: 'read',
      target: 'xd://eval/browser',
      input: { path: 'xd://eval/browser' },
    })).toEqual({ title: 'Read', subtitle: 'xd://eval/browser' });
  });

  test('keeps the topic, not just the device', () => {
    // `xdDevice` reports `eval`; the card must name `xd://eval/browser`.
    expect(header({ type: 'read', target: 'xd://eval/browser', input: { path: 'xd://eval/browser' } }).subtitle)
      .toBe('xd://eval/browser');
  });

  test('names the bare listing too', () => {
    expect(header({ type: 'read', target: 'xd://', input: { path: 'xd://' } }))
      .toEqual({ title: 'Read', subtitle: 'xd://' });
  });

  test('a write to the same URL still names the device action, never the URL', () => {
    const call = tool({ type: 'write', target: 'xd://lsp', title: 'write — xd://lsp' });
    const resolved = toolCardSubtitle(call, toolCardHeader(call, resolveToolKey(call)));
    expect(resolved).not.toBe('xd://lsp');
  });
});

describe('toolCardHeader — generic', () => {
  test('splits a `name — subject` title', () => {
    expect(header({ type: 'bash', title: 'grep — export function ToolCallCard' }))
      .toEqual({ title: 'Grep', subtitle: 'export function ToolCallCard' });
  });

  test('carries the subagent from tasks[0] for a task call', () => {
    expect(header({
      type: 'task',
      input: { tasks: [{ name: 'Scout', agent: 'scout' }] },
    })).toEqual({ title: 'Task', subtitle: 'Scout · scout' });
  });

  test('falls back to the tool key when there is no title', () => {
    expect(header({ type: 'bash', title: '' }).title).toBe('Bash');
  });
});

describe('toolCardSubtitle', () => {
  test('never shows a bare xd:// URL', () => {
    const call = tool({ type: 'write', target: 'xd://lsp', title: 'write' });
    const resolved = toolCardSubtitle(call, { title: 'Write', subtitle: 'xd://lsp' });
    expect(resolved).toBeUndefined();
  });

  test('prefers the header subtitle, then the target file', () => {
    const call = tool({ type: 'read', target: 'src/x.ts' });
    expect(toolCardSubtitle(call, { title: 'Read', subtitle: 'from disk' })).toBe('from disk');
    expect(toolCardSubtitle(call, { title: 'Read' })).toBe('src/x.ts');
  });
});
