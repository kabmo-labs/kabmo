/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Agent file naming, enforced on both sides of the wire.
 *
 * The route refuses an unsafe base name and the pane refuses the same name
 * before it sends one. Pinned here so the two cannot drift: a name the pane
 * accepted and the route rejected would surface as a 400 under a form that
 * looked valid.
 */

import { describe, expect, test } from 'bun:test';
import { agentFileBaseName, agentFileNameError } from '@/shared/lib/omp/config/agent-file';

describe('agentFileNameError', () => {
  test('accepts a normal agent name', () => {
    expect(agentFileNameError('reviewer')).toBeNull();
    expect(agentFileNameError('code-reviewer.v2')).toBeNull();
    expect(agentFileNameError('  helper_1 ')).toBeNull();
  });

  test('refuses an empty name with a sentence that says what it becomes', () => {
    expect(agentFileNameError('   ')).toContain('becomes the definition');
  });

  test('refuses a path or a space instead of letting the route answer 400', () => {
    expect(agentFileNameError('a/b')).toContain('letters, numbers');
    expect(agentFileNameError('../escape')).toContain('letters, numbers');
    expect(agentFileNameError('bad name')).toContain('letters, numbers');
    expect(agentFileNameError('-leading')).toContain('letters, numbers');
  });
});

describe('agentFileBaseName', () => {
  test('strips the directory and the extension', () => {
    expect(agentFileBaseName('/home/u/.omp/agent/agents/reviewer.md')).toBe('reviewer');
    expect(agentFileBaseName('C:/agents/helper.MD')).toBe('helper');
    expect(agentFileBaseName('plain')).toBe('plain');
  });
});
