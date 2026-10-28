/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Covers the boundaries of the subagent label derivation: the Target-section
 * scan (heading level, colon variant, section end) and the two identity shapes.
 *
 * These are the cases where the label is derived from prompt text the caller
 * controls, so a wrong boundary silently renders template boilerplate or a
 * section name where the assignment's headline belongs.
 */

import { describe, expect, test } from 'bun:test';

import { assignmentTarget, subagentHeaderTitle, subagentRowLabel } from '@/shared/lib/omp/subagent/label';
import type { SubagentInfo } from '@/shared/types/omp/subagent';

/** Minimal roster entry — only the fields the label helpers read. */
function makeSubagent(overrides: Partial<SubagentInfo> = {}): SubagentInfo {
  return { id: 'Scout', agent: 'task', status: 'completed', index: 0, ...overrides };
}

describe('assignmentTarget', () => {
  test('reads the headline under the task template Target section', () => {
    const task = 'Complete assignment thoroughly:\n\n# Target\nCount .tsx files under src/.\n\n# Change\nNone.\n\n# Acceptance\nReport the integer.';
    expect(assignmentTarget(task)).toBe('Count .tsx files under src/.');
  });

  test('stops at the next heading so Change prose never becomes the headline', () => {
    const task = '# Target\nMap the panel data model.\n\n# Change\nDo the thing';
    expect(assignmentTarget(task)).toBe('Map the panel data model.');
  });

  test('accepts any heading level and a trailing colon', () => {
    expect(assignmentTarget('## Target:\nHeadline here')).toBe('Headline here');
    expect(assignmentTarget('### Target\nHeadline here')).toBe('Headline here');
  });

  test('skips an empty Target section instead of promoting the next section', () => {
    expect(assignmentTarget('# Target\n\n# Change\nDo the thing')).toBe('Do the thing');
  });

  test('falls back to the first prose line when no Target section exists', () => {
    expect(assignmentTarget('Fix the sidebar expand bug')).toBe('Fix the sidebar expand bug');
    expect(assignmentTarget('# Scope\nNot a target section')).toBe('Not a target section');
  });

  test('never returns the template lead-in or a bare heading', () => {
    expect(assignmentTarget('Complete assignment thoroughly:')).toBeUndefined();
    expect(assignmentTarget('# Target')).toBeUndefined();
  });

  test('returns undefined for absent or empty text', () => {
    expect(assignmentTarget(undefined)).toBeUndefined();
    expect(assignmentTarget('   \n\n  ')).toBeUndefined();
  });
});

describe('subagentHeaderTitle', () => {
  test('appends the model role recorded on a history entry', () => {
    expect(subagentHeaderTitle(makeSubagent({ modelRole: 'smol' }))).toBe('Scout (task:smol)');
  });

  test('falls back to the role carried by a live progress frame', () => {
    expect(subagentHeaderTitle(makeSubagent({ progress: { modelRole: 'task' } }))).toBe('Scout (task:task)');
  });

  test('omits the role when the run recorded none', () => {
    expect(subagentHeaderTitle(makeSubagent())).toBe('Scout (task)');
  });
});

describe('subagentRowLabel', () => {
  test('appends the assignment headline to the identity', () => {
    const subagent = makeSubagent({ task: 'Complete assignment thoroughly:\n\n# Target\nHeadline here.\n\n# Change\nx' });
    expect(subagentRowLabel(subagent)).toBe('Scout (task): Headline here.');
  });

  test('reads the assignment field when the task template is absent', () => {
    expect(subagentRowLabel(makeSubagent({ assignment: '# Target\nFrom the assignment field.' })))
      .toBe('Scout (task): From the assignment field.');
  });

  test('falls back to the description, then to the bare identity', () => {
    expect(subagentRowLabel(makeSubagent({ description: 'fallback description' }))).toBe('Scout (task): fallback description');
    expect(subagentRowLabel(makeSubagent())).toBe('Scout (task)');
  });

  test('keeps the identity when the assignment has no usable headline', () => {
    expect(subagentRowLabel(makeSubagent({ task: '# Target' }))).toBe('Scout (task)');
  });
});
