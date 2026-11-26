/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The agent-name table. Each row here was read off an adapter's own tool
 * registry (opencode 2.2.5 names its plugins `shell`, `todowrite`, `webfetch`,
 * `websearch`, `subagent`, `patch`), because a card whose name is not one of
 * Kabmo's keys opens no panel at all.
 */

import { describe, expect, test } from 'bun:test';
import { canonicalAgentToolName } from './tool-aliases';

describe('canonicalAgentToolName', () => {
  test('folds the names ACP agents report onto the renderer keys', () => {
    expect(canonicalAgentToolName('shell')).toBe('bash');
    expect(canonicalAgentToolName('todowrite')).toBe('todo');
    expect(canonicalAgentToolName('webfetch')).toBe('web_search');
    expect(canonicalAgentToolName('websearch')).toBe('web_search');
    expect(canonicalAgentToolName('subagent')).toBe('task');
    expect(canonicalAgentToolName('patch')).toBe('edit');
    expect(canonicalAgentToolName('apply_patch')).toBe('edit');
  });

  test('matches regardless of case', () => {
    expect(canonicalAgentToolName('Shell')).toBe('bash');
    expect(canonicalAgentToolName('TODOWRITE')).toBe('todo');
  });

  test('folds each adapter shell spelling onto bash', () => {
    expect(canonicalAgentToolName('exec_command')).toBe('bash');
    expect(canonicalAgentToolName('run_shell_command')).toBe('bash');
    expect(canonicalAgentToolName('run_terminal_command')).toBe('bash');
    expect(canonicalAgentToolName('shell_command')).toBe('bash');
    expect(canonicalAgentToolName('write_stdin')).toBe('bash');
    expect(canonicalAgentToolName('PowerShell')).toBe('bash');
  });

  test('folds each adapter edit spelling onto edit or write', () => {
    expect(canonicalAgentToolName('StrReplaceFile')).toBe('edit');
    expect(canonicalAgentToolName('str_replace_editor')).toBe('edit');
    expect(canonicalAgentToolName('replace_file_content')).toBe('edit');
    expect(canonicalAgentToolName('multi_replace_file_content')).toBe('edit');
    expect(canonicalAgentToolName('search_replace')).toBe('edit');
    expect(canonicalAgentToolName('NotebookEdit')).toBe('edit');
    expect(canonicalAgentToolName('WriteFile')).toBe('write');
    expect(canonicalAgentToolName('write_to_file')).toBe('write');
  });

  test('folds each adapter read and search spelling', () => {
    expect(canonicalAgentToolName('ReadFile')).toBe('read');
    expect(canonicalAgentToolName('ReadMediaFile')).toBe('read');
    expect(canonicalAgentToolName('view_file')).toBe('read');
    expect(canonicalAgentToolName('read_directory')).toBe('read');
    expect(canonicalAgentToolName('list_dir')).toBe('read');
    expect(canonicalAgentToolName('grep_search')).toBe('grep');
    expect(canonicalAgentToolName('search_files')).toBe('grep');
    expect(canonicalAgentToolName('find_by_name')).toBe('grep');
  });

  test('folds the remaining vendor slots', () => {
    expect(canonicalAgentToolName('FetchURL')).toBe('web_search');
    expect(canonicalAgentToolName('read_url_content')).toBe('web_search');
    expect(canonicalAgentToolName('web_extract')).toBe('web_search');
    expect(canonicalAgentToolName('SetTodoList')).toBe('todo');
    expect(canonicalAgentToolName('delegate_task')).toBe('task');
    expect(canonicalAgentToolName('run_code')).toBe('eval');
    expect(canonicalAgentToolName('execute_code')).toBe('eval');
    expect(canonicalAgentToolName('execute')).toBe('eval');
  });

  test('leaves an unknown name, and an MCP identifier, unchanged', () => {
    expect(canonicalAgentToolName('VendorWidget')).toBe('VendorWidget');
    expect(canonicalAgentToolName('mcp__Codegraph_Explore')).toBe('mcp__Codegraph_Explore');
    expect(canonicalAgentToolName(undefined)).toBe('');
  });
});
