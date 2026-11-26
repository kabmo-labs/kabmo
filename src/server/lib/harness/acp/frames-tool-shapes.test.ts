/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Vendor tool shapes through the ACP accumulator.
 *
 * `frames.test.ts` covers the lifecycle (create, patch, close); this file covers
 * what a REAL adapter puts in those frames, measured against opencode 2.2.5:
 *
 *  - the tool is named `shell` and its result lives under `rawOutput.metadata`
 *    (`exit`, `truncated`) rather than omp's `details`;
 *  - an edit reports its patch as `metadata.files[].patch`, not as an ACP
 *    `diff` content block;
 *  - `kind:"think"` is a reasoning call, not a file read.
 *
 * Split from `frames.test.ts` when the cases pushed that file past the ceiling.
 */

import { describe, expect, test } from 'bun:test';
import { AcpFrameMapper } from '@/server/lib/harness/acp/frames';
import { normalizeAgentEvent } from '@/server/lib/chat/normalize-tools.server';
import { parseMessageBlocks, toToolCallData } from '@kabmo-labs/kabmo-omp-session-parse/parse-message-blocks';
import { toolPanelKind } from '@/client/components/workspace/chat-timeline/tool-renderers/registry';

/**
 * The panel a frame's first tool call renders — through the SAME pipeline the
 * product uses: the adapter's block, the server normalizer, the shared parser,
 * then the client's read-only lookup. Asserting the mapper's own fields would
 * pin an intermediate value that no renderer reads.
 */
function panelOf(frames: readonly Record<string, unknown>[]): string | null {
  const messageUpdate = frames.find((frame) => frame.type === 'message_update');
  if (!messageUpdate) return null;
  const normalized = normalizeAgentEvent(messageUpdate as { type: string; [key: string]: unknown });
  const message = normalized.message as { content?: unknown } | undefined;
  const parsed = parseMessageBlocks(message?.content);
  const call = parsed.toolCalls[0];
  return call ? toolPanelKind(toToolCallData(call, { streaming: true })) : null;
}

/** The message blocks a frame carries, narrowed without an unchecked cast. */
function contentOf(frame: unknown): Record<string, unknown>[] {
  if (!frame || typeof frame !== 'object' || !('message' in frame)) return [];
  const message = frame.message;
  if (!message || typeof message !== 'object' || !('content' in message)) return [];
  const content = message.content;
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object')
    : [];
}

describe('acp frame mapper — vendor tool shapes', () => {
  test('an opencode shell call becomes the bash card with its exit status', () => {
    // Before the name fold the panel lookup read `shell`, found no panel, and
    // drew the generic Input/Output body.
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'sh1',
      name: 'shell',
      title: 'ls -la',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'ls -la', description: 'List files', cwd: '/tmp/x' },
      locations: [{ path: '/tmp/x' }],
    });
    const block = contentOf(frames[0]);
    expect(block[0]).toMatchObject({ name: 'bash' });
    expect(frames[1]).toMatchObject({ toolName: 'bash' });
    expect(panelOf(frames)).toBe('bash');

    const end = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'sh1',
      status: 'completed',
      content: [{ type: 'content', content: { type: 'text', text: 'total 0' } }],
      rawOutput: { metadata: { exit: 1, truncated: false, status: 'completed' } },
    });
    expect(end[0]).toMatchObject({
      type: 'tool_execution_end',
      output: 'total 0',
      details: { exitCode: 1, truncated: false },
    });
  });

  test('the command opencode sends one patch later reaches the card', () => {
    // opencode opens the call from `session.tool.input.started` with an EMPTY
    // input and sends `{command}` on `session.tool.called`. A patch that kept
    // only the fields it knew left the Bash card with no command at all.
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'sh2',
      name: 'shell',
      title: 'shell',
      kind: 'execute',
      status: 'pending',
      rawInput: { cwd: '/tmp/x' },
      locations: [{ path: '/tmp/x' }],
    });
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'sh2',
      kind: 'execute',
      status: 'in_progress',
      title: 'ls -la',
      rawInput: { command: 'ls -la', cwd: '/tmp/x' },
    });
    expect(frames[0].type).toBe('message_update');
    const blocks = contentOf(frames[0]);
    expect(blocks[0]).toMatchObject({ type: 'toolCall', name: 'bash', arguments: { command: 'ls -la' } });
    expect(frames.at(-1)).toMatchObject({ type: 'tool_execution_update' });
  });

  test('a patch with no rawInput does not re-emit the card', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'sh3',
      name: 'shell',
      kind: 'execute',
      status: 'pending',
      rawInput: { command: 'ls' },
    });
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'sh3',
      status: 'completed',
      content: [{ type: 'text', text: 'done' }],
    });
    expect(frames.map((frame) => frame.type)).toEqual(['tool_execution_end']);
  });

  test('an opencode edit turns metadata.files into the diff the panel draws', () => {
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'ed1',
      name: 'edit',
      title: 'src/a.ts',
      kind: 'edit',
      status: 'pending',
      rawInput: { path: 'src/a.ts', oldString: 'a', newString: 'b' },
    });
    const end = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'ed1',
      status: 'completed',
      rawOutput: {
        metadata: { files: [{ file: 'src/a.ts', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n-a\n+b' }] },
      },
    });
    const details = end[0].details as { diff?: string; path?: string };
    expect(details.path).toBe('src/a.ts');
    expect(details.diff).toContain('+b');
  });

  test('a pi-acp shell result arrives only through _meta terminal channels', () => {
    // pi-acp 0.x sends `content: [{type:"terminal"}]` on the call and the whole
    // result in `_meta.terminal_output.data` / `_meta.terminal_exit.exit_code`,
    // because it expects the client to own a terminal. Kabmo advertises none,
    // so without folding `_meta` the card had a title and an empty body.
    const mapper = new AcpFrameMapper();
    mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'pi1',
      title: 'bun test',
      kind: 'execute',
      status: 'completed',
      content: [{ type: 'terminal', terminalId: 'pi1' }],
      _meta: { terminal_info: { terminal_id: 'pi1', cwd: '/tmp/x' } },
    });
    const end = mapper.mapUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'pi1',
      status: 'completed',
      content: null,
      _meta: {
        terminal_output: { terminal_id: 'pi1', data: '12 pass' },
        terminal_exit: { terminal_id: 'pi1', exit_code: 1, signal: null },
      },
    });
    expect(end[0]).toMatchObject({
      type: 'tool_execution_end',
      output: '12 pass',
      details: { exitCode: 1 },
    });
  });

  test('a pi-acp shell call takes its command from the title', () => {
    // pi sends `rawInput: null` for every tool; a shell call's only statement
    // of what ran is its title.
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'pi2',
      title: 'bun test src/a.test.ts',
      kind: 'execute',
      status: 'in_progress',
    });
    expect(frames.find((frame) => frame.type === 'tool_execution_start')).toMatchObject({
      toolName: 'bash',
      args: { command: 'bun test src/a.test.ts' },
    });
    expect(contentOf(frames[0])[0]).toMatchObject({
      name: 'bash',
      arguments: { command: 'bun test src/a.test.ts' },
    });
  });

  test('a nameless call is named by its kind, so the panel still opens', () => {
    // Measured codex-acp: a file change arrives with `title: "Editing files"`,
    // `kind: "edit"` and NO name. The card had no identity, so the renderer
    // fell back to the generic Input/Output body over a call that carried a
    // full diff.
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'cx1',
      title: 'Editing files',
      kind: 'edit',
      status: 'pending',
      locations: [{ path: 'src/a.ts' }],
      content: [{ type: 'diff', path: 'src/a.ts', oldText: 'a\nb', newText: 'a\nc' }],
    });
    // The kind is the only identity the adapter sent, so the SERVER names the
    // call by it and the panel opens.
    expect(frames.find((frame) => frame.type === 'tool_execution_start')).toMatchObject({ toolName: 'edit' });
    expect(panelOf(frames)).toBe('edit');
  });

  test('a call with only a title still reaches a panel, because the title travels', () => {
    // An adapter that names nothing at all (codex-acp's file change is
    // `title:"Editing files"`) used to produce a card with no identity, so the
    // renderer fell back to a generic body.
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'ti1',
      title: 'Run Command',
      status: 'pending',
    });
    expect(contentOf(frames[0])[0]).toMatchObject({ title: 'Run Command' });
    expect(panelOf(frames)).toBe('bash');
  });

  test('kind `think` is a reasoning type, and its own name decides the panel', () => {
    const mapper = new AcpFrameMapper();
    const frames = mapper.mapUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'th1',
      name: 'reasoning',
      title: 'reasoning',
      kind: 'think',
      status: 'pending',
      rawInput: { thought: 'hmm' },
    });
    expect(frames.find((frame) => frame.type === 'tool_execution_start')).toMatchObject({
      toolName: 'reasoning',
    });
    expect(contentOf(frames[0])[0]).toMatchObject({ name: 'reasoning', toolKind: 'think' });
    expect(panelOf(frames)).toBe('think');
  });
});
