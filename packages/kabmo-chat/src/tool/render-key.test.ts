/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The ONE tool classification, pinned against every vocabulary Kabmo meets.
 *
 * This replaces the client-side panel test: the table used to live in the
 * renderer folder, which is what made the client a second classifier. The
 * cases are unchanged — they are the measured adapter vocabularies — but the
 * answer is now the server's `render` family, and a call no rule matches must
 * come back `custom` so the card shows raw JSON instead of a guessed panel.
 */

import { describe, expect, test } from 'bun:test';
import { resolveToolRender, type ToolRenderInput } from './render-key';
import type { ToolRenderKey } from '@kabmo-labs/kabmo-chat/contracts/tool-render';

function key(input: ToolRenderInput): ToolRenderKey {
  return resolveToolRender(input).key;
}

describe('resolveToolRender — canonical omp tools', () => {
  const EXPECTED: Record<string, ToolRenderKey> = {
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
    wait: 'wait',
  };

  for (const [name, expected] of Object.entries(EXPECTED)) {
    test(`${name} → ${expected}`, () => {
      expect(key({ name, type: name })).toBe(expected);
      expect(resolveToolRender({ name, type: name }).normalized).toBe(true);
    });
  }
});

describe('resolveToolRender — ACP agent vocabulary', () => {
  test('folds the names opencode reports onto their panels', () => {
    expect(key({ name: 'shell' })).toBe('bash');
    expect(key({ name: 'todowrite' })).toBe('todo');
    expect(key({ name: 'webfetch' })).toBe('web_search');
    expect(key({ name: 'websearch' })).toBe('web_search');
    expect(key({ name: 'subagent' })).toBe('task');
    expect(key({ name: 'patch' })).toBe('edit');
    expect(key({ name: 'apply_patch' })).toBe('edit');
  });

  test('folds the names claude-code-acp and codex-acp report', () => {
    expect(key({ name: 'PowerShell' })).toBe('bash');
    expect(key({ name: 'exec_command' })).toBe('bash');
    expect(key({ name: 'run_shell_command' })).toBe('bash');
    expect(key({ name: 'update_plan' })).toBe('todo');
    expect(key({ name: 'Agent' })).toBe('task');
    expect(key({ name: 'view_image' })).toBe('read');
  });

  test('folds the gemini-family file tool names', () => {
    expect(key({ name: 'write_file' })).toBe('write');
    expect(key({ name: 'replace' })).toBe('edit');
    expect(key({ name: 'list_directory' })).toBe('read');
    expect(key({ name: 'read_many_files' })).toBe('read');
    expect(key({ name: 'search_file_content' })).toBe('grep');
    expect(key({ name: 'web_fetch' })).toBe('web_search');
  });

  test('a delegation spelling is a task card, never a file read', () => {
    for (const name of ['spawn_subagent', 'invoke_subagent', 'spawn_agent', 'delegate']) {
      expect(key({ name })).toBe('task');
    }
  });

  test('an adapter kind names the panel when the name does not', () => {
    // The bug this replaces: `kind:"other"` + a title produced `type:"bash"`
    // and NO panel, because the client lookup read only the name.
    expect(key({ kind: 'execute' })).toBe('bash');
    expect(key({ kind: 'search' })).toBe('grep');
    expect(key({ kind: 'delete' })).toBe('edit');
    expect(key({ kind: 'think' })).toBe('think');
    expect(key({ kind: 'fetch' })).toBe('web_search');
    // `switch_mode` names no operation: a plan-mode toggle is not a todo list.
    expect(key({ kind: 'switch_mode' })).toBe('custom');
    // An adapter's own kind keeps its raw value and stays generic.
    expect(key({ kind: 'other', rawKind: 'delegate' })).toBe('custom');
  });

  test('a title-only call still finds its family', () => {
    expect(key({ title: 'Run Command' })).toBe('bash');
    expect(key({ title: 'Editing files' })).toBe('edit');
  });
});

describe('resolveToolRender — legacy aliases', () => {
  test('folds the MOCK file aliases onto their omp tool', () => {
    expect(key({ name: 'read_file' })).toBe('read');
    expect(key({ name: 'view_file' })).toBe('read');
    expect(key({ name: 'edit_file' })).toBe('edit');
    expect(key({ name: 'create_file' })).toBe('write');
  });

  test('folds the terminal aliases onto bash', () => {
    expect(key({ name: 'terminal' })).toBe('bash');
    expect(key({ name: 'run_command' })).toBe('bash');
  });

  test('folds the memory family onto one panel', () => {
    for (const name of ['retain', 'recall', 'reflect', 'learn']) {
      expect(key({ name })).toBe('memory_edit');
    }
  });
});

describe('resolveToolRender — device, MCP and documentation calls', () => {
  test('names an xd:// device call by the device, not the transport write', () => {
    expect(key({ name: 'write', target: 'xd://lsp', input: { path: 'xd://lsp', content: '{}' } })).toBe('lsp');
  });

  test('a proc:// URL names the process panel whatever the transport', () => {
    expect(key({ name: 'read', target: 'proc://job-1' })).toBe('proc');
    expect(key({ name: 'write', input: { path: 'proc://job-1' } })).toBe('proc');
  });

  test('a read of a tool-documentation URL is a read, both spellings', () => {
    expect(key({ name: 'read', target: 'xd://lsp/topics' })).toBe('read');
    expect(key({ name: 'read', input: { path: 'help://eval/browser' } })).toBe('read');
  });

  test('an mcp__ name is the MCP panel', () => {
    expect(key({ name: 'mcp__sqlite_query' })).toBe('mcp');
  });
});

describe('resolveToolRender — the unclassified fallback', () => {
  test('an unknown name with no kind is custom, not a guessed panel', () => {
    const render = resolveToolRender({ name: 'VendorWidget', title: 'VendorWidget — ls' });
    expect(render).toEqual({ key: 'custom', normalized: false });
  });

  test('nothing at all is custom', () => {
    expect(resolveToolRender({})).toEqual({ key: 'custom', normalized: false });
  });
});
