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
import { canonicalAgentToolName } from '@/shared/lib/chat/tool/tool-aliases';

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

  test('leaves an unknown name, and an MCP identifier, unchanged', () => {
    expect(canonicalAgentToolName('VendorWidget')).toBe('VendorWidget');
    expect(canonicalAgentToolName('mcp__Codegraph_Explore')).toBe('mcp__Codegraph_Explore');
    expect(canonicalAgentToolName(undefined)).toBe('');
  });
});
