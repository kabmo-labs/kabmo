/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The resolution half of the generating-indicator phrases, plus the turn-matching
 * helpers the chat loader and the jump rail share.
 *
 * `describeToolActivity` decides what the docked row says while the agent works,
 * and it has four inputs that fight over the subject: explicit args, the
 * Kabmo's `command`/`target` backfill fields, the model's own `intent`, and the
 * `xd://<device>` inner tool. The tests pin that precedence (subject beats
 * intent; args beat input; a device names the action instead of `write`) because
 * getting it wrong shows a confidently wrong sentence, not a missing one.
 * `describeAssistantPhase` is the streaming entry point: `thinking*`/`text*`
 * must not fall through to a tool phrase, and a `toolcall_*` frame without a
 * resolvable block must yield undefined rather than a phantom "Working".
 *
 * `userTurnsRelate` exists because omp rewrites delivered prompts, so equality
 * is not enough; each rewrite rule (`@agent` delegation, `/skill:` synthesis) is
 * pinned so a reload stops duplicating or dropping turns.
 */

import { describe, expect, test } from 'bun:test';

import type { ToolCallData } from '@/shared/types';
import {
  describeAssistantPhase,
  describeToolActivity,
  describeToolCall,
} from '@/shared/lib/chat/timeline/tool-verbs';
import { TURN_PREVIEW_CHARS, isRawComposerInput, userTurnsRelate } from '@/shared/lib/chat/timeline/turns';

describe('describeToolActivity', () => {
  test('names a known tool and its subject', () => {
    expect(describeToolActivity({ name: 'read', args: { path: 'src/a.ts' } })).toBe('Reading src/a.ts');
    expect(describeToolActivity({ name: 'bash', args: { command: 'ls -la' } })).toBe('Running ls -la');
  });

  test('normalizes legacy aliases and case', () => {
    expect(describeToolActivity({ name: 'read_file', args: { path: 'a.ts' } })).toBe('Reading a.ts');
    expect(describeToolActivity({ name: 'BASH', args: { command: 'pwd' } })).toBe('Running pwd');
  });

  test('an unknown tool still reads as running something', () => {
    expect(describeToolActivity({ name: 'frobnicate' })).toBe('Running frobnicate');
    expect(describeToolActivity({})).toBe('Working');
  });

  test('a proc:// call names the operation, not the read/write transport', () => {
    // `Reading proc://kabmo-dev/kill` would describe a service stop as a
    // file read — the URL is the only thing that names what happened.
    expect(describeToolActivity({ name: 'write', args: { path: 'proc://kabmo-dev/kill' } })).toBe(
      'Stopping kabmo-dev',
    );
    expect(describeToolActivity({ name: 'read', args: { path: 'proc://ompdev' } })).toBe('Reading process ompdev');
    expect(describeToolActivity({ name: 'read', args: { path: 'proc://' } })).toBe('Listing processes');
    expect(describeToolActivity({ name: 'write', args: { path: 'proc://svc' } })).toBe('Sending input to svc');
    expect(describeToolActivity({ name: 'write', args: { path: 'proc://svc/mode' } })).toBe('Setting mode on svc');
  });

  test('a stem with no subject is a complete phrase, never a dangling one', () => {
    expect(describeToolActivity({ name: 'write' })).toBe('Writing');
    expect(describeToolActivity({ name: 'edit' })).toBe('Editing');
  });

  test('falls back to the model intent when no subject can be derived', () => {
    expect(describeToolActivity({ name: 'read', intent: 'Checking the config' })).toBe('Checking the config');
    expect(describeToolActivity({ name: 'read', args: { i: 'Looking around' } })).toBe('Looking around');
  });

  test('a derived subject beats the model intent', () => {
    expect(describeToolActivity({ name: 'read', args: { path: 'a.ts', i: 'whatever' } })).toBe('Reading a.ts');
  });

  test('backfills command/target and reads input records, args winning over input', () => {
    expect(describeToolActivity({ name: 'bash', command: 'ls' })).toBe('Running ls');
    expect(describeToolActivity({ name: 'read', target: 'src/a.ts' })).toBe('Reading src/a.ts');
    expect(describeToolActivity({ name: 'read', input: { path: 'a.ts' } })).toBe('Reading a.ts');
    expect(describeToolActivity({ name: 'read', args: { path: 'a.ts' }, input: { path: 'b.ts' } })).toBe(
      'Reading a.ts',
    );
  });

  test('a raw string input is not parsed, so only the stem is known', () => {
    expect(describeToolActivity({ name: 'read', input: '{"path":"a.ts"}' })).toBe('Reading');
  });

  test('truncates a phrase longer than the subject budget', () => {
    const phrase = describeToolActivity({ name: 'read', args: { path: 'p'.repeat(100) } });
    expect(phrase.length).toBe(72);
    expect(phrase.endsWith('…')).toBe(true);
  });

  test('a write to xd://<device> names the device, not the write', () => {
    expect(
      describeToolActivity({
        name: 'write',
        args: { path: 'xd://lsp', content: '{"action":"symbols","symbol":"Foo"}' },
      }),
    ).toBe('Running LSP symbols Foo');
  });

  test('device verbs cover unknown devices and mcp__ inner tools', () => {
    expect(describeToolActivity({ name: 'write', args: { path: 'xd://custom' } })).toBe('Running custom');
    expect(describeToolActivity({ name: 'write', args: { path: 'xd://mcp__weather' } })).toBe('Running weather');
  });

  test('a prose device payload surfaces its first line as the subject', () => {
    expect(
      describeToolActivity({ name: 'write', args: { path: 'xd://resolve', content: 'Apply this patch\nmore' } }),
    ).toBe('Applying edit proposal Apply this patch');
  });

  test('a device URL may arrive as target or command too', () => {
    expect(describeToolActivity({ name: 'write', target: 'xd://debug' })).toBe('Debugging');
    expect(describeToolActivity({ name: 'write', command: 'xd://ast_grep?x=1' })).toBe('Searching AST');
  });
});

describe('describeToolCall', () => {
  const call = (partial: Partial<ToolCallData>): ToolCallData => ({ id: '1', type: 'read', title: '', ...partial });

  test('resolves a Kabmo row the same way as a live call', () => {
    expect(describeToolCall(call({ name: 'read', input: { path: 'a.ts' } }))).toBe('Reading a.ts');
  });

  test('falls back to the row type when no name is present', () => {
    expect(describeToolCall(call({ type: 'bash', command: 'ls' }))).toBe('Running ls');
  });
});

describe('describeAssistantPhase', () => {
  test('maps thinking and text phases without inventing a tool', () => {
    expect(describeAssistantPhase({ type: 'thinking_start' })).toBe('Thinking');
    expect(describeAssistantPhase({ type: 'thinking' })).toBe('Thinking');
    expect(describeAssistantPhase({ type: 'text_delta' })).toBe('Writing response');
    expect(describeAssistantPhase({ type: 'text' })).toBe('Writing response');
  });

  test('reads the streaming tool block from partial.content', () => {
    const event = {
      type: 'toolcall_start',
      contentIndex: 0,
      partial: { content: [{ type: 'toolCall', name: 'read', arguments: { path: 'a.ts' } }] },
    };
    expect(describeAssistantPhase(event)).toBe('Reading a.ts');
  });

  test('defaults to the last content block when no index is given', () => {
    const event = {
      type: 'toolcall_delta',
      partial: {
        content: [
          { type: 'text', text: 'hi' },
          { type: 'toolCall', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
    };
    expect(describeAssistantPhase(event)).toBe('Running ls');
  });

  test('a frame without a resolvable tool block yields nothing', () => {
    expect(describeAssistantPhase({ type: 'toolcall_start', partial: { content: [{ type: 'text' }] } })).toBeUndefined();
    expect(describeAssistantPhase({ type: 'toolcall_start' })).toBeUndefined();
    expect(describeAssistantPhase({ type: 'toolcall_start', contentIndex: 5, partial: { content: [] } })).toBeUndefined();
  });

  test('toolcall_end reads the completed toolCall', () => {
    expect(
      describeAssistantPhase({ type: 'toolcall_end', toolCall: { name: 'bash', arguments: { command: 'ls' } } }),
    ).toBe('Running ls');
    expect(describeAssistantPhase({ type: 'toolcall_end' })).toBeUndefined();
  });

  test('ignores unknown or malformed events', () => {
    expect(describeAssistantPhase({ type: 'something_else' })).toBeUndefined();
    expect(describeAssistantPhase({ type: 42 })).toBeUndefined();
    expect(describeAssistantPhase('thinking_start')).toBeUndefined();
    expect(describeAssistantPhase(null)).toBeUndefined();
  });
});

describe('isRawComposerInput', () => {
  test('recognizes slash commands, including after leading whitespace', () => {
    expect(isRawComposerInput('/help')).toBe(true);
    expect(isRawComposerInput('  /skill:diagnose')).toBe(true);
  });

  test('recognizes an @mention token at the start or after whitespace', () => {
    expect(isRawComposerInput('@file.ts look')).toBe(true);
    expect(isRawComposerInput('use @agent here')).toBe(true);
  });

  test('an email address is not a mention', () => {
    expect(isRawComposerInput('mail me at foo@bar.com')).toBe(false);
  });

  test('plain prose and the empty string are delivered prompts', () => {
    expect(isRawComposerInput('fix the bug')).toBe(false);
    expect(isRawComposerInput('')).toBe(false);
  });
});

describe('userTurnsRelate', () => {
  test('equal or prefix-related prompts are the same request', () => {
    expect(userTurnsRelate('fix it', 'fix it')).toBe(true);
    expect(userTurnsRelate('fix it now', 'fix it')).toBe(true);
    expect(userTurnsRelate('fix it', 'fix it now')).toBe(true);
    expect(userTurnsRelate('fix it', 'other')).toBe(false);
  });

  test('an @agent prompt matches its task-tool delegation rewrite', () => {
    const delegated = 'Use the task tool to delegate this request to the @reviewer agent';
    expect(userTurnsRelate(delegated, 'please check @reviewer')).toBe(true);
    expect(userTurnsRelate(delegated, 'plain request')).toBe(false);
  });

  test('a /skill: prompt matches the synthesized /skill:<name> token', () => {
    expect(userTurnsRelate('/skill:diagnose now', '/skill:diagnose')).toBe(true);
    expect(userTurnsRelate('/skill:diagnose now', '/skill:other')).toBe(false);
    expect(userTurnsRelate('/skill:diagnose now', 'unrelated')).toBe(false);
  });

  test('shares the rail tooltip preview length', () => {
    expect(TURN_PREVIEW_CHARS).toBe(220);
  });
});
