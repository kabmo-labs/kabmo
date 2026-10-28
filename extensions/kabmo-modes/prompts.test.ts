/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Drift check for the vendored prompt templates.
 *
 * The extension ships its own copies of four omp prompt files, because omp's
 * package `exports` map cannot resolve a `.md` import from an extension
 * (measured: `Cannot find package '@oh-my-pi/pi-coding-agent'`) and because the
 * wording IS the contract — `plan-mode-approved.md` is what makes an approved
 * plan authoritative over earlier exploration, so a silent upstream rewrite
 * would change execution semantics with nothing in this repo changing.
 *
 * The test reads the installed omp package when it is present and asserts each
 * template matches byte for byte. Absent package → skipped, so a checkout
 * without omp still runs its suite.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  GOAL_CONTINUATION_PROMPT,
  GUIDED_GOAL_INTERVIEW_PROMPT,
  PLAN_MODE_APPROVED_PROMPT,
  PLAN_MODE_COMPACT_INSTRUCTIONS_PROMPT,
  renderPrompt,
} from './prompts';

/** omp's global install layout; `~/.bun/bin/omp` symlinks into the same
 *  package, so this is the tree the running child loads from. */
const OMP_PROMPTS = join(homedir(), '.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent/src/prompts');

const CASES: Array<[string, string, string]> = [
  ['plan-mode-approved', PLAN_MODE_APPROVED_PROMPT, join(OMP_PROMPTS, 'system/plan-mode-approved.md')],
  [
    'plan-mode-compact-instructions',
    PLAN_MODE_COMPACT_INSTRUCTIONS_PROMPT,
    join(OMP_PROMPTS, 'system/plan-mode-compact-instructions.md'),
  ],
  ['guided-goal-interview', GUIDED_GOAL_INTERVIEW_PROMPT, join(OMP_PROMPTS, 'goals/guided-goal-interview.md')],
  ['goal-continuation', GOAL_CONTINUATION_PROMPT, join(OMP_PROMPTS, 'goals/goal-continuation.md')],
];

describe('vendored omp prompt templates', () => {
  for (const [name, vendored, ompPath] of CASES) {
    test(`${name} matches the installed omp package`, () => {
      if (!existsSync(ompPath)) {
        console.warn(`[prompts.test] omp not installed at ${ompPath}; skipping drift check`);
        return;
      }
      expect(vendored.trim()).toBe(readFileSync(ompPath, 'utf8').trim());
    });
  }
});

describe('renderPrompt', () => {
  test('substitutes placeholders and drops a falsy block', () => {
    const rendered = renderPrompt('A {{x}} {{#if y}}YES{{/if}} B', { x: 1, y: false });
    expect(rendered).toBe('A 1  B');
  });

  test('keeps a truthy block and leaves unknown placeholders intact', () => {
    const rendered = renderPrompt('{{#if y}}YES {{z}}{{/if}}', { y: true });
    expect(rendered).toBe('YES {{z}}');
  });
});
