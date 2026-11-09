import { describe, expect, test } from 'bun:test';
import {
  toAgentPickItems,
  toFilePickItems,
  toHarnessPickItems,
} from '@/shared/lib/chat/composer/client';

describe('pick item mapping', () => {
  test('an agent becomes a bare @name token', () => {
    const [item] = toAgentPickItems([
      { id: 'a1', name: 'sonic', description: 'fast', scope: 'user', systemPrompt: '' },
    ]);
    expect(item).toMatchObject({
      id: 'agent-sonic',
      name: 'sonic',
      kind: 'agent',
      source: 'agent',
      token: '@sonic',
    });
  });

  test('a harness becomes a namespaced default-model token', () => {
    const [item] = toHarnessPickItems().filter((entry) => entry.token === '@harness:claude');
    expect(item).toMatchObject({
      id: 'harness-claude',
      kind: 'harness',
      source: 'harness',
      token: '@harness:claude',
    });
  });

  test('a file is namespaced under file:, so a root-level name cannot shadow an agent', () => {
    const [item] = toFilePickItems([{ name: 'sonic', path: 'sonic' }]);
    expect(item.token).toBe('@file:sonic');
    expect(item.path).toBe('sonic');
  });

  test('a path with whitespace is quoted, so the token cannot end early', () => {
    const [item] = toFilePickItems([{ name: 'my notes.md', path: 'docs/my notes.md' }]);
    expect(item.token).toBe('@"file:docs/my notes.md"');
  });
});
