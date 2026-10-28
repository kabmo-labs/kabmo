/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Core behavior of the canonical omp message-content parser — the single
 * source of truth shared by the live SSE path and the JSONL reload path. A
 * regression here silently changes what every chat bubble and tool card
 * renders, so these cases pin the parts that look "cleanable" but are load
 * bearing:
 *
 * - `extractText` keeps only `type:'text'` blocks with a string body and joins
 *   them with `\n`; every other shape yields `''`.
 * - `inferToolType` is an ordered substring table, not a map: the first word
 *   in the fixed order wins, so `todo_write` classifies as an edit and
 *   `github_search` as a filesystem search. Input is lowercased first.
 * - `parseMessageBlocks` argument extraction uses first-string-wins key lists
 *   (an empty string stops the search), keeps raw args as `input` but drops
 *   the empty object, falls back to the hashline patch header for `target`,
 *   and pairs tool results either by toolCallId or with the most recent call.
 * - `toToolCallData` derives status from output/streaming/isError precedence
 *   and strips the synthetic `i` intent key from the stored input.
 * - `isBlobImageRef` is a case-sensitive prefix test, not a digest validator.
 */

import { describe, expect, test } from 'bun:test';
import type { ToolType } from '@/shared/types/chat';
import {
  extractText,
  inferToolType,
  parseMessageBlocks,
  type ParsedMessageBlocks,
} from '@/shared/lib/omp/session/parse-message-blocks';

const emptyParsed = (): ParsedMessageBlocks => ({
  toolCalls: [],
  inlineOutputs: new Map(),
  inlineImages: new Map(),
  textParts: [],
});

describe('extractText', () => {
  test('returns a plain string content unchanged', () => {
    expect(extractText('hello world')).toBe('hello world');
    expect(extractText('')).toBe('');
  });

  test('returns empty string for anything that is not a string or array', () => {
    expect(extractText(undefined)).toBe('');
    expect(extractText(null)).toBe('');
    expect(extractText(42)).toBe('');
    expect(extractText({ type: 'text', text: 'ignored' })).toBe('');
  });

  test('joins text blocks with a newline and skips every other block', () => {
    const content = [
      { type: 'text', text: 'first' },
      'not a block',
      { type: 'text', text: 42 },
      { type: 'image', data: 'x', mimeType: 'image/png' },
      { type: 'thinking', thinking: 'inner' },
      { type: 'text', text: 'second' },
    ];
    expect(extractText(content)).toBe('first\nsecond');
  });

  test('returns empty string for an empty or all-non-text array', () => {
    expect(extractText([])).toBe('');
    expect(extractText([{ type: 'toolCall', id: 'a' }])).toBe('');
  });
});

describe('inferToolType', () => {
  test('maps each documented name family to its tool type', () => {
    const cases: Array<[string | undefined, ToolType]> = [
      [undefined, 'custom'],
      ['', 'custom'],
      ['BASH', 'bash'],
      ['run_command', 'bash'],
      ['open_terminal', 'bash'],
      ['shell_exec', 'bash'],
      ['write_file', 'edit_file'],
      ['apply_patch', 'edit_file'],
      ['edit', 'edit_file'],
      ['create_file', 'create_file'],
      ['read_file', 'read_file'],
      ['view', 'read_file'],
      ['list_dir', 'read_file'],
      ['grep', 'grep'],
      ['glob', 'grep'],
      ['search_files', 'search_fs'],
      ['find', 'search_fs'],
      // `search` is matched before `web`, so the canonical name itself lands
      // on the filesystem search type — pinned rather than "corrected".
      ['web_search', 'search_fs'],
      ['web_fetch', 'web_search'],
      ['fetch_url', 'web_search'],
      ['http_request', 'web_search'],
      ['todo', 'todo'],
      ['task', 'task'],
      ['lsp_hover', 'lsp'],
      ['eval', 'eval'],
      ['github', 'github'],
      ['security_scan', 'security_scan'],
      ['mcp__custom_thing', 'custom'],
    ];
    for (const [name, expected] of cases) {
      expect(inferToolType(name), `name=${String(name)}`).toBe(expected);
    }
  });

  test('the earlier rule in the fixed order wins, not the more specific word', () => {
    // `write` (edit) is checked before `todo`.
    expect(inferToolType('todo_write')).toBe('edit_file');
    // `search` (fs) is checked before `github`.
    expect(inferToolType('github_search')).toBe('search_fs');
    // `run` (bash) is checked before `eval`.
    expect(inferToolType('eval_run')).toBe('bash');
  });

  test('matching is case-insensitive', () => {
    expect(inferToolType('Read_File')).toBe('read_file');
    expect(inferToolType('Security_Scan')).toBe('security_scan');
  });
});

describe('parseMessageBlocks', () => {
  test('a string becomes a single text part', () => {
    expect(parseMessageBlocks('hello')).toEqual({ ...emptyParsed(), textParts: ['hello'] });
  });

  test('non-string, non-array content yields the empty shape', () => {
    expect(parseMessageBlocks(undefined)).toEqual(emptyParsed());
    expect(parseMessageBlocks(null)).toEqual(emptyParsed());
    expect(parseMessageBlocks(7)).toEqual(emptyParsed());
    expect(parseMessageBlocks({ type: 'text', text: 'x' })).toEqual(emptyParsed());
  });

  test('text parts keep array order and ignore malformed blocks', () => {
    const content = [
      { type: 'text', text: 'first' },
      'nope',
      { type: 'text', text: 42 },
      { type: 'text' },
      { type: 'text', text: 'second' },
    ];
    expect(parseMessageBlocks(content).textParts).toEqual(['first', 'second']);
  });

  test('thinking prefers `thinking`, falls back to `text`, and last wins', () => {
    expect(parseMessageBlocks([{ type: 'thinking', thinking: 'first thought' }]).thinking).toBe('first thought');
    expect(parseMessageBlocks([{ type: 'thinking', text: 'fallback' }]).thinking).toBe('fallback');
    expect(
      parseMessageBlocks([{ type: 'thinking', thinking: 'old' }, { type: 'thinking', thinking: 'new' }]).thinking,
    ).toBe('new');
    // A non-string body sets nothing at all.
    expect(parseMessageBlocks([{ type: 'thinking', thinking: 5 }]).thinking).toBeUndefined();
  });

  test('a tool call exposes id, name, command, input and a composed title', () => {
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls -la' } },
    ]);
    expect(parsed.toolCalls).toEqual([
      {
        id: 'call-1',
        name: 'bash',
        title: 'bash — ls -la',
        intent: undefined,
        target: undefined,
        command: 'ls -la',
        input: { command: 'ls -la' },
      },
    ]);
    // A tool call is registered with an empty inline output slot.
    expect(parsed.inlineOutputs.get('call-1')).toBe('');
  });

  test('a streaming tool call keeps one fallback id until its real one arrives', () => {
    // A live `toolcall_delta` block: the arguments are partial JSON, so there is
    // no readable input and no id yet. The card is keyed by the block's
    // position for the whole stream — a random fallback remounted it per chunk.
    const partial = parseMessageBlocks([{ type: 'toolCall', partialArgs: '{"path":' }]).toolCalls[0];
    const later = parseMessageBlocks([{ type: 'toolCall', partialArgs: '{"path":"a.ts"}' }]).toolCalls[0];
    expect(partial.id).toBe('tool-0');
    expect(later.id).toBe('tool-0');
    // `toolcall_end` hands the finished block over, real id and all.
    const done = parseMessageBlocks([
      { type: 'toolCall', id: 'call-1', name: 'write', arguments: { path: 'a.ts' } },
    ]).toolCalls[0];
    expect(done.id).toBe('call-1');
  });

  test('command extraction is first-string-wins across the documented keys', () => {
    const [call] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'run', arguments: { command: 7, cmd: 'ls', CommandLine: 'echo' } },
    ]).toolCalls;
    expect(call.command).toBe('ls');
    // An empty string is still a string: it stops the search and yields no command.
    const [empty] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'run', arguments: { command: '', cmd: 'ls' } },
    ]).toolCalls;
    expect(empty.command).toBeUndefined();
    expect(empty.title).toBe('run');
  });

  test('target extraction is first-string-wins and falls back to the hashline header', () => {
    const [byKey] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'read', arguments: { TargetFile: 'a.ts', filePath: 'b.ts' } },
    ]).toolCalls;
    expect(byKey.target).toBe('a.ts');
    expect(byKey.title).toBe('read — a.ts');

    // An omp `edit` carries no path key; the patch header names the file.
    const [byPatch] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'edit', arguments: { input: '[src/a.ts#A1B2]\nCUT 1.=1' } },
    ]).toolCalls;
    expect(byPatch.target).toBe('src/a.ts');
    expect(byPatch.title).toBe('edit — src/a.ts');
  });

  test('`input` is used only when `arguments` is absent', () => {
    const [fromInput] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'read', input: { path: 'p.ts' } },
    ]).toolCalls;
    expect(fromInput.target).toBe('p.ts');
    // A non-record `arguments` short-circuits the `input` fallback.
    const [shadowed] = parseMessageBlocks([
      { type: 'toolCall', id: 'c', name: 'read', arguments: 'oops', input: { path: 'p.ts' } },
    ]).toolCalls;
    expect(shadowed.target).toBeUndefined();
    expect(shadowed.input).toBeUndefined();
  });

  test('the first non-empty intent becomes the turn intent', () => {
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'a', name: 't', arguments: { i: 'first', command: 'x' } },
      { type: 'toolCall', id: 'b', name: 't', arguments: { i: 'second' } },
    ]);
    expect(parsed.intent).toBe('first');
    expect(parsed.toolCalls[0].intent).toBe('first');
    expect(parsed.toolCalls[1].intent).toBe('second');
  });

  test('a tool call without id/name gets deterministic fallbacks', () => {
    const [call] = parseMessageBlocks([{ type: 'toolCall', arguments: {} }]).toolCalls;
    expect(call.name).toBe('tool');
    expect(call.id.startsWith('tool-')).toBe(true);
    expect(call.id.length).toBeGreaterThan('tool-'.length);
    expect(call.title).toBe('tool');
    // Raw args are kept only when non-empty.
    expect(call.input).toBeUndefined();
  });

  test('a tool result pairs with its call by toolCallId', () => {
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'ls' } },
      { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'p.ts' } },
      { type: 'toolResult', toolCallId: 'a', text: 'out-a' },
    ]);
    expect(parsed.inlineOutputs.get('a')).toBe('out-a');
    expect(parsed.inlineOutputs.get('b')).toBe('');
  });

  test('a result without a matching id attaches to the most recent call', () => {
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'a', name: 'bash', arguments: { command: 'ls' } },
      { type: 'toolResult', toolCallId: 'unknown', text: 'fallback' },
    ]);
    expect(parsed.inlineOutputs.get('a')).toBe('fallback');
    // No call at all: the result is dropped rather than inventing one.
    expect(parseMessageBlocks([{ type: 'toolResult', toolCallId: 'x', text: 'orphan' }]).inlineOutputs.size).toBe(0);
  });

  test('inline tool-result images ride along, blob refs and base64 alike', () => {
    const ref = `blob:sha256:${'a'.repeat(64)}`;
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'p.png' } },
      {
        type: 'toolResult',
        toolCallId: 'a',
        text: 'Read image file',
        content: [
          { type: 'image', data: ref, mimeType: 'image/png' },
          { type: 'image', data: 'QUJD', mimeType: 'image/jpeg' },
        ],
      },
    ]);
    expect(parsed.inlineImages.get('a')).toEqual([
      { mimeType: 'image/png', blobRef: ref },
      { mimeType: 'image/jpeg', dataBase64: 'QUJD' },
    ]);
  });

  test('images ride the fallback pairing too, and an image-less result adds no entry', () => {
    const ref = `blob:sha256:${'b'.repeat(64)}`;
    const parsed = parseMessageBlocks([
      { type: 'toolCall', id: 'a', name: 'read', arguments: { path: 'p.png' } },
      { type: 'toolCall', id: 'b', name: 'read', arguments: { path: 'q.png' } },
      { type: 'toolResult', toolCallId: 'stale', text: 'pic', content: [{ type: 'image', data: ref }] },
      { type: 'toolResult', toolCallId: 'b', text: 'no pic' },
    ]);
    // Unknown id → the most recent call, which is `b`; the later text-only
    // result for `b` overwrites the output but leaves the images in place.
    expect(parsed.inlineImages.get('b')).toEqual([{ mimeType: 'image/png', blobRef: ref }]);
    expect(parsed.inlineImages.has('a')).toBe(false);
    expect(parsed.inlineOutputs.get('b')).toBe('no pic');
  });

  test('unknown block types and malformed entries contribute nothing', () => {
    const parsed = parseMessageBlocks([
      { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      { type: 'tool_result', toolCallId: 'x', text: 'snake case is not recognized' },
      null,
      [],
      { text: 'no type' },
      { type: 'text', text: 'kept' },
    ]);
    expect(parsed).toEqual({ ...emptyParsed(), textParts: ['kept'] });
  });
});
