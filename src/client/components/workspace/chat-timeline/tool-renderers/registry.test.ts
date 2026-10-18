/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Panel classification, without mounting a panel.
 *
 * The old dispatch answered "does this tool have a panel?" by CALLING the
 * renderer and discarding its VNode, so it could not be tested without a DOM
 * and it rebuilt the panel's tree on every streaming frame. `toolPanelKind` is
 * a pure lookup now, and this file is what keeps the mapping honest: every tool
 * name the timeline can produce, every legacy alias the MOCK path sends, and
 * every `xd://` device call.
 *
 * The coverage list is omp's own builtin census — a tool that gains a panel
 * later is one row in `registry.ts`, and a tool that LOSES one fails here.
 */

import { describe, expect, test } from 'bun:test';
import { toolPanelKind, xdDevice, xdDocPath, type ToolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

describe('toolPanelKind — canonical omp tools', () => {
  const EXPECTED: Record<string, ToolPanelKind> = {
    read: 'read',
    edit: 'edit',
    write: 'write',
    bash: 'bash',
    eval: 'eval',
    grep: 'grep',
    glob: 'grep',
    search_fs: 'search_fs',
    todo: 'todo',
    task: 'task',
    web_search: 'web_search',
    lsp: 'lsp',
    ast_edit: 'ast_edit',
    resolve: 'resolve',
    reject: 'reject',
    hub: 'proc',
    github: 'github',
    checkpoint: 'checkpoint',
    security_scan: 'security_scan',
    debug: 'debug',
    manage_skill: 'manage_skill',
    context_notes: 'context_notes',
    memory_edit: 'memory_edit',
    goal: 'goal',
    ask: 'ask',
    think: 'think',
  };

  for (const [name, kind] of Object.entries(EXPECTED)) {
    test(`${name} → ${kind}`, () => {
      expect(toolPanelKind(tool({ type: name as ToolCallData['type'] }))).toBe(kind);
    });
  }
});

describe('toolPanelKind — legacy aliases', () => {
  test('folds the MOCK file aliases onto their omp tool', () => {
    expect(toolPanelKind(tool({ type: 'read_file' }))).toBe('read');
    expect(toolPanelKind(tool({ type: 'view_file' }))).toBe('read');
    expect(toolPanelKind(tool({ type: 'edit_file' }))).toBe('edit');
    expect(toolPanelKind(tool({ type: 'create_file' }))).toBe('write');
  });

  test('folds the terminal aliases onto bash', () => {
    expect(toolPanelKind(tool({ type: 'terminal' }))).toBe('bash');
    expect(toolPanelKind(tool({ type: 'run_command' }))).toBe('bash');
  });

  test('folds the memory family onto one panel', () => {
    for (const type of ['retain', 'recall', 'reflect', 'learn']) {
      expect(toolPanelKind(tool({ type: type as ToolCallData['type'] }))).toBe('memory_edit');
    }
  });
});

describe('toolPanelKind — device and MCP calls', () => {
  test('names an xd:// device call by the device, not the transport write', () => {
    expect(toolPanelKind(tool({
      type: 'write',
      name: 'write',
      target: 'xd://lsp',
      input: { path: 'xd://lsp', content: '{}' },
    }))).toBe('lsp');
  });

  test('reads the device out of details.xdev when the target is gone', () => {
    expect(toolPanelKind(tool({
      type: 'write',
      details: { xdev: { tool: 'xd://ast_edit', mode: 'execute' } },
    }))).toBe('ast_edit');
  });

  test('folds the ast_grep device onto the search panel', () => {
    expect(toolPanelKind(tool({
      type: 'write',
      details: { xdev: { tool: 'ast_grep' } },
    }))).toBe('grep');
  });

  test('classifies any mcp__ name as the MCP panel', () => {
    expect(toolPanelKind(tool({ type: 'custom', name: 'mcp__codegraph_explore' }))).toBe('mcp');
    expect(toolPanelKind(tool({ type: 'write', target: 'xd://mcp__codegraph_node' }))).toBe('mcp');
  });

  // `proc://` is read/write transport with a device URL, exactly like `xd://`,
  // and it must win over the transport's own panel: `read proc://ompdev` drew
  // the read panel (service log as file contents) and `write proc://x/kill`
  // drew the edit panel (stdin payload as a written file).
  test('names a proc:// call by the process, not the read/write transport', () => {
    expect(toolPanelKind(tool({
      type: 'read',
      name: 'read',
      target: 'proc://ompchamber-dev',
      input: { path: 'proc://ompchamber-dev' },
    }))).toBe('proc');
    expect(toolPanelKind(tool({
      type: 'write',
      name: 'write',
      target: 'proc://ompchamber-dev/kill',
      input: { path: 'proc://ompchamber-dev/kill', content: null },
    }))).toBe('proc');
  });

  test('reads the proc URL out of the input path when the target is gone', () => {
    expect(toolPanelKind(tool({
      type: 'read',
      input: { path: 'proc://' },
    }))).toBe('proc');
  });

  test('a plain file read is still the read panel', () => {
    expect(toolPanelKind(tool({
      type: 'read',
      target: 'src/x.ts',
      input: { path: 'src/x.ts' },
    }))).toBe('read');
  });

  // `read xd://<device>` is the device's DOCUMENTATION (omp's `xdevDocs`), not a
  // call — its own reader draws it as an ordinary read. Dispatching by device
  // sent `read xd://lsp` to the LSP diagnostics card and
  // `read xd://mcp__codegraph_explore` to the MCP argument card, both over a
  // page of prose. The WRITE transport is the opposite and must keep reaching
  // the device's panel.
  test('a read of a device URL is the read panel, not the device panel', () => {
    for (const path of ['xd://', 'xd://lsp', 'xd://eval/browser', 'xd://mcp__codegraph_explore', 'xd://propose']) {
      expect(toolPanelKind(tool({ type: 'read', target: path, input: { path } }))).toBe('read');
    }
  });

  test('a write to the same device URL still reaches the device panel', () => {
    expect(toolPanelKind(tool({
      type: 'write',
      target: 'xd://lsp',
      input: { path: 'xd://lsp', content: '{"action":"diagnostics"}' },
    }))).toBe('lsp');
    expect(toolPanelKind(tool({
      type: 'write',
      target: 'xd://mcp__codegraph_explore',
      input: { path: 'xd://mcp__codegraph_explore', content: '{"query":"x"}' },
    }))).toBe('mcp');
  });

  test('the doc-read predicate carries the FULL path, not just the device', () => {
    // `xd://eval/browser` is the browser topic of the `eval` device; `xdDevice`
    // reports only `eval`, which named the card wrong.
    expect(xdDocPath(tool({ type: 'read', target: 'xd://eval/browser', input: { path: 'xd://eval/browser' } })))
      .toBe('xd://eval/browser');
    expect(xdDocPath(tool({ type: 'read', target: 'xd://', input: { path: 'xd://' } }))).toBe('xd://');
    expect(xdDocPath(tool({ type: 'read', target: 'src/x.ts', input: { path: 'src/x.ts' } }))).toBeUndefined();
    expect(xdDocPath(tool({ type: 'write', target: 'xd://lsp', input: { path: 'xd://lsp' } }))).toBeUndefined();
  });
});

describe('toolPanelKind — no panel', () => {
  test('returns null for a tool with only generic rendering', () => {
    expect(toolPanelKind(tool({ type: 'browser' }))).toBeNull();
    expect(toolPanelKind(tool({ type: 'report_issue' }))).toBeNull();
  });

  test('a wait call reaches its own panel', () => {
    // `wait` blocks on background jobs for up to 30 minutes and its result is
    // the only place their status and elapsed time exist. Without a panel it
    // rendered as a title and an empty Output block.
    expect(toolPanelKind(tool({ type: 'wait' }))).toBe('wait');
    expect(toolPanelKind(tool({ type: 'wait', name: 'wait' }))).toBe('wait');
  });

  test('returns null for an unknown custom tool', () => {
    expect(toolPanelKind(tool({ type: 'custom', name: 'some_plugin_tool' }))).toBeNull();
  });
});

describe('xdDevice', () => {
  test('extracts the device from a target URL', () => {
    expect(xdDevice(tool({ type: 'write', target: 'xd://resolve' }))).toBe('resolve');
  });

  test('extracts the device from the input path', () => {
    expect(xdDevice(tool({ type: 'write', input: { path: 'xd://debug' } }))).toBe('debug');
  });

  test('returns undefined for a plain file write', () => {
    expect(xdDevice(tool({ type: 'write', target: 'src/x.ts', input: { path: 'src/x.ts' } }))).toBeUndefined();
  });
});
