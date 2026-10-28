/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The data half of the generating-indicator phrases.
 *
 * `subjectFor` is a per-tool switch where every case owns its connector, and a
 * wrong connector is user-visible (`for "pat"` vs `for pat`, `· init` vs
 * `: init`). The tests pin each case's exact wording and its fallbacks, plus the
 * quoting rule (a subject already starting with a quote is not double-quoted)
 * and the `pick`/`asString` primitives the whole table is built on — those
 * primitives decide whether a value from a nested array or a whitespace-only
 * string ever reaches the phrase.
 *
 * `subjectFor('edit')` has a real fallback worth pinning: omp's hashline `edit`
 * carries the file in the patch header rather than a `path` argument, so without
 * the fallback the phrase degrades to a bare `Editing`.
 */

import { describe, expect, test } from 'bun:test';

import {
  DEVICE_VERBS,
  MAX_SUBJECT,
  PHASE_VERBS,
  TOOL_ALIASES,
  TOOL_VERBS,
  asString,
  pick,
  subjectFor,
  truncate,
} from '@/shared/lib/chat/timeline/tool-phrases';

describe('asString', () => {
  test('keeps trimmed non-empty strings and drops everything else', () => {
    expect(asString('  hello  ')).toBe('hello');
    expect(asString('   ')).toBeUndefined();
    expect(asString('')).toBeUndefined();
    expect(asString(42)).toBeUndefined();
    expect(asString(null)).toBeUndefined();
    expect(asString(undefined)).toBeUndefined();
    expect(asString({ a: 1 })).toBeUndefined();
  });
});

describe('pick', () => {
  test('returns the first present key, in the order given', () => {
    expect(pick({ a: 'x', b: 'y' }, ['b', 'a'])).toBe('y');
    expect(pick({ a: 'x', b: 'y' }, ['c', 'a'])).toBe('x');
  });

  test('skips blank and non-string values', () => {
    expect(pick({ a: '  ', b: 'y' }, ['a', 'b'])).toBe('y');
    expect(pick({ a: 3, b: 'y' }, ['a', 'b'])).toBe('y');
  });

  test('yields the first string of an array value', () => {
    expect(pick({ a: ['', 7, 'z'] }, ['a'])).toBe('z');
    expect(pick({ a: [1, 2] }, ['a'])).toBeUndefined();
    expect(pick({ a: [] }, ['a'])).toBeUndefined();
  });

  test('is undefined when no key matches', () => {
    expect(pick({}, ['a'])).toBeUndefined();
  });
});

describe('truncate', () => {
  test('keeps a subject of exactly MAX_SUBJECT unchanged', () => {
    expect(truncate('a'.repeat(MAX_SUBJECT))).toBe('a'.repeat(MAX_SUBJECT));
  });

  test('elides a longer subject to MAX_SUBJECT characters including the ellipsis', () => {
    const result = truncate('a'.repeat(MAX_SUBJECT + 1));
    expect(result).toBe(`${'a'.repeat(MAX_SUBJECT - 1)}…`);
    expect(result.length).toBe(MAX_SUBJECT);
  });
});

describe('tool phrase tables', () => {
  test('canonical names and legacy aliases resolve to the expected stems', () => {
    expect(TOOL_VERBS.read).toBe('Reading');
    expect(TOOL_VERBS.todo).toBe('Updating plan');
    expect(TOOL_ALIASES.read_file).toBe('read');
    expect(TOOL_ALIASES.terminal).toBe('bash');
    expect(DEVICE_VERBS.lsp).toBe('Running LSP');
    expect(PHASE_VERBS.sideQuestion).toBe('Answering side question');
  });
});

describe('subjectFor', () => {
  test('read/write/edit prefer path and fall back to the hashline header', () => {
    expect(subjectFor('read', { path: 'src/a.ts' })).toBe('src/a.ts');
    expect(subjectFor('write', { file: 'b.ts' })).toBe('b.ts');
    expect(subjectFor('edit', { AbsolutePath: '/x/c.ts' })).toBe('/x/c.ts');
    expect(subjectFor('edit', { input: '[src/hash.ts#AB12]\nPUT 1:\n+x' })).toBe('src/hash.ts');
    expect(subjectFor('read', {})).toBeUndefined();
  });

  test('ast_edit reads the first path of an array', () => {
    expect(subjectFor('ast_edit', { paths: ['a.ts', 'b.ts'] })).toBe('a.ts');
    expect(subjectFor('ast_edit', {})).toBeUndefined();
  });

  test('ast_grep quotes the pattern and leaves an already-quoted one alone', () => {
    expect(subjectFor('ast_grep', { pat: 'foo' })).toBe('for "foo"');
    expect(subjectFor('ast_grep', { pat: '"foo"' })).toBe('for "foo"');
    expect(subjectFor('ast_grep', {})).toBeUndefined();
  });

  test('bash reads command/cmd/CommandLine', () => {
    expect(subjectFor('bash', { command: 'ls -la' })).toBe('ls -la');
    expect(subjectFor('bash', { cmd: 'pwd' })).toBe('pwd');
    expect(subjectFor('bash', { CommandLine: 'echo hi' })).toBe('echo hi');
  });

  test('grep composes pattern and scope, degrading cleanly', () => {
    expect(subjectFor('grep', { pattern: 'foo', path: 'src' })).toBe('for "foo" in src');
    expect(subjectFor('grep', { pattern: 'foo' })).toBe('for "foo"');
    expect(subjectFor('grep', { path: 'src' })).toBe('src');
    expect(subjectFor('grep', {})).toBeUndefined();
  });

  test('glob and web_search', () => {
    expect(subjectFor('glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
    expect(subjectFor('web_search', { query: 'bun test' })).toBe('for "bun test"');
    expect(subjectFor('web_search', {})).toBeUndefined();
  });

  test('task names the subagent and its agent, from the first task when unnamed', () => {
    expect(subjectFor('task', { name: 'SidebarFix', agent: 'general' })).toBe('to SidebarFix (general)');
    expect(subjectFor('task', { name: 'SidebarFix' })).toBe('to SidebarFix');
    expect(subjectFor('task', { agent: 'explore' })).toBe('to explore');
    expect(subjectFor('task', { tasks: [{ name: 'T', agent: 'a' }] })).toBe('to T (a)');
    expect(subjectFor('task', {})).toBeUndefined();
  });

  test('hub, todo and eval use their own connectors', () => {
    expect(subjectFor('hub', { op: 'set', name: 'x' })).toBe('set x');
    expect(subjectFor('hub', { op: 'list' })).toBe('list');
    expect(subjectFor('hub', {})).toBeUndefined();
    expect(subjectFor('todo', { op: 'init' })).toBe('· init');
    expect(subjectFor('todo', {})).toBeUndefined();
    expect(subjectFor('eval', { language: 'ts' })).toBe('in ts');
  });

  test('lsp, debug and github join their two fields', () => {
    expect(subjectFor('lsp', { action: 'symbols', symbol: 'Foo' })).toBe('symbols Foo');
    expect(subjectFor('lsp', { action: 'hover' })).toBe('hover');
    expect(subjectFor('lsp', {})).toBeUndefined();
    expect(subjectFor('debug', { action: 'attach' })).toBe('attach');
    expect(subjectFor('github', { op: 'pr', repo: 'o/r' })).toBe('pr o/r');
    expect(subjectFor('github', {})).toBeUndefined();
  });

  test('ask reads the first question header, then its question text', () => {
    expect(subjectFor('ask', { questions: [{ header: 'Pick one' }] })).toBe('Pick one');
    expect(subjectFor('ask', { questions: [{ question: 'What?' }] })).toBe('What?');
    expect(subjectFor('ask', { questions: ['not a record'] })).toBeUndefined();
    expect(subjectFor('ask', {})).toBeUndefined();
  });

  test('checkpoint, manage_skill, recall and reflect', () => {
    expect(subjectFor('checkpoint', { goal: 'Ship it' })).toBe('Ship it');
    expect(subjectFor('manage_skill', { name: 'create-skill' })).toBe('create-skill');
    expect(subjectFor('recall', { query: 'auth' })).toBe('"auth"');
    expect(subjectFor('reflect', { query: 'auth' })).toBe('on "auth"');
    expect(subjectFor('reflect', {})).toBeUndefined();
  });

  test('security_scan and retain read their structured payloads', () => {
    expect(subjectFor('security_scan', { target_kind: 'deps' })).toBe('deps');
    expect(subjectFor('security_scan', { include_paths: ['src'] })).toBe('src');
    expect(subjectFor('retain', { items: [{ content: 'remember this' }] })).toBe('"remember this"');
    expect(subjectFor('retain', { items: [] })).toBeUndefined();
  });

  test('an unknown tool falls back to the common subject keys', () => {
    expect(subjectFor('mystery', { path: 'a.ts' })).toBe('a.ts');
    expect(subjectFor('mystery', { prose: 'did a thing' })).toBe('did a thing');
    expect(subjectFor('mystery', {})).toBeUndefined();
  });
});
