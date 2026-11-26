/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where each adapter puts the tool's NAME, through the product pipeline.
 *
 * `frames-tool-shapes.test.ts` covers the SHAPES one adapter sends. This file
 * covers IDENTITY recovery, because a missed name costs the operator a panel:
 *
 *  - zcode names its tool only in `_meta.claudeCode.toolName` and sends
 *    `kind:"other"` for a subagent, so a `task` drew NO card;
 *  - qwen names it only in a flat `_meta.toolName`, so `grep_search` degraded
 *    to a bare `grep`;
 *  - kimi sends neither `name` nor `kind`; the tool is the `<tool>:` prefix of
 *    `title`, and `SetTodoList` used to match the `list` substring and draw a
 *    READ card while `StrReplaceFile` drew the JSON fallback;
 *  - dsh/hermes/opencode name the call correctly but in their own vocabulary,
 *    so `run_code`/`execute_code`/`execute` drew a Bash console instead of
 *    Eval and `delegate_task` drew Bash instead of Task.
 *
 * Every case asserts the panel the card ends up with, not the mapper's
 * intermediate fields.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@kabmo-labs/kabmo-acp-mapper/frames';
import { normalizeAgentEvent } from '@/server/lib/chat/normalize-tools.server';
import { parseMessageBlocks, toToolCallData } from '@kabmo-labs/kabmo-omp-session-parse/parse-message-blocks';
import { toolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

/** The panel a frame's first tool call renders, through the SAME pipeline the
 *  product uses: adapter block → server normalizer → shared parser → client
 *  lookup. */
function panelOf(frames: readonly Record<string, unknown>[]): string | null {
  const update = frames.find((frame) => frame.type === 'message_update');
  if (!update) return null;
  const normalized = normalizeAgentEvent(update as { type: string; [key: string]: unknown });
  const message = normalized.message as { content?: unknown } | undefined;
  const call = parseMessageBlocks(message?.content).toolCalls[0];
  return call ? toolPanelKind(toToolCallData(call, { streaming: true })) : null;
}

/** The canonical name the card carries. */
function nameOf(frames: readonly Record<string, unknown>[]): unknown {
  const update = frames.find((frame) => frame.type === 'message_update') as
    | { message?: { content?: { name?: unknown }[] } }
    | undefined;
  return update?.message?.content?.[0]?.name;
}

interface Case {
  label: string;
  /** The `session/update` the adapter sends. */
  update: Record<string, unknown>;
  name: string;
  panel: string;
}

const CASES: Case[] = [
  {
    label: 'zcode: a subagent named only in _meta.claudeCode.toolName',
    // `kind:"other"` is all the bridge sends; without the meta read the card
    // had no panel at all (measured on zcode-acp-server 0.82.3).
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'z1',
      title: 'audit auth',
      kind: 'other',
      status: 'pending',
      rawInput: { prompt: 'audit auth' },
      _meta: { claudeCode: { toolName: 'Agent' }, subagent: true },
    },
    name: 'task',
    panel: 'task',
  },
  {
    label: 'qwen: a name only in the flat _meta.toolName',
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'q1',
      title: 'Grep: pattern',
      kind: 'search',
      status: 'pending',
      rawInput: { pattern: 'x' },
      _meta: { toolName: 'grep_search' },
    },
    name: 'grep',
    panel: 'grep',
  },
  {
    label: 'kimi: an edit named only by the title prefix',
    // Before the title-prefix rule this drew the JSON fallback.
    update: { sessionUpdate: 'tool_call', toolCallId: 'k1', title: 'StrReplaceFile: src/a.ts', status: 'in_progress' },
    name: 'edit',
    panel: 'edit',
  },
  {
    label: 'kimi: a write is a write, not an edit',
    update: { sessionUpdate: 'tool_call', toolCallId: 'k2', title: 'WriteFile: src/a.ts', status: 'in_progress' },
    name: 'write',
    panel: 'write',
  },
  {
    label: 'kimi: SetTodoList is a plan, not a directory listing',
    // No `": "` in the title, so there is no prefix to lift and the card keeps
    // the adapter's own word; the ALIAS row is what turns it into a plan. The
    // `list` substring used to win first and draw a READ card.
    update: { sessionUpdate: 'tool_call', toolCallId: 'k3', title: 'SetTodoList', status: 'in_progress' },
    name: 'SetTodoList',
    panel: 'todo',
  },
  {
    label: 'dsh: run_code is a script, not a shell',
    update: { sessionUpdate: 'tool_call', toolCallId: 'd1', title: 'run_code', kind: 'other', status: 'pending' },
    name: 'run_code',
    panel: 'eval',
  },
  {
    label: 'hermes: delegate_task is a child agent, not a command',
    // `kind:"execute"` made this a Bash card before the alias row existed.
    update: {
      sessionUpdate: 'tool_call',
      toolCallId: 'h1',
      name: 'delegate_task',
      title: 'delegate_task: audit auth',
      kind: 'execute',
      status: 'pending',
      rawInput: { prompt: 'audit auth' },
    },
    name: 'task',
    panel: 'task',
  },
  {
    label: 'opencode: Code Mode execute is a script',
    update: { sessionUpdate: 'tool_call', toolCallId: 'o1', name: 'execute', kind: 'execute', status: 'pending' },
    name: 'eval',
    panel: 'eval',
  },
  {
    label: 'antigravity: find_by_name is a content search',
    update: { sessionUpdate: 'tool_call', toolCallId: 'a1', name: 'find_by_name', kind: 'other', status: 'pending' },
    name: 'grep',
    panel: 'grep',
  },
  {
    label: 'command-code: shell_command is the bash card',
    update: { sessionUpdate: 'tool_call', toolCallId: 'c1', name: 'shell_command', kind: 'execute', status: 'pending' },
    name: 'bash',
    panel: 'bash',
  },
  {
    label: 'codex: write_stdin belongs to the exec slot',
    update: { sessionUpdate: 'tool_call', toolCallId: 'x1', name: 'write_stdin', kind: 'execute', status: 'in_progress' },
    name: 'bash',
    panel: 'bash',
  },
  {
    label: 'grok: list_dir is a read',
    update: { sessionUpdate: 'tool_call', toolCallId: 'g1', name: 'list_dir', kind: 'other', status: 'pending' },
    name: 'read',
    panel: 'read',
  },
];

describe('acp frame mapper — vendor tool names', () => {
  for (const item of CASES) {
    test(item.label, () => {
      const frames = new AcpFrameMapper().mapUpdate(item.update);
      expect(nameOf(frames)).toBe(item.name);
      expect(panelOf(frames)).toBe(item.panel);
      // The start frame names the call the same way, so the live indicator and
      // the stored card cannot disagree.
      expect(frames.find((frame) => frame.type === 'tool_execution_start')).toMatchObject({ toolName: item.name });
    });
  }

  test('a title with no tool prefix still opens the kind panel', () => {
    // codex-acp's file change: no name, `kind:"edit"`, and a title that is
    // prose. The title must not be mistaken for an identity.
    const frames = new AcpFrameMapper().mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'cx1',
      title: 'Editing files',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: 'src/a.ts' }],
    });
    expect(nameOf(frames)).toBe('edit');
    expect(panelOf(frames)).toBe('edit');
  });

  test('a name the adapter DID send is never replaced by the alias table', () => {
    // `name` outranks `kind` and the aliases: a vendor tool called `execute`
    // that is really a shell keeps its own identity when it says so.
    const frames = new AcpFrameMapper().mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'p1',
      name: 'VendorWidget',
      title: 'widget',
      kind: 'execute',
      status: 'pending',
    });
    expect(nameOf(frames)).toBe('VendorWidget');
    // An unknown name with a known kind still lands on that kind's panel.
    expect(panelOf(frames)).toBe('bash');
  });
});
