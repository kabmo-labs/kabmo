/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The TUI-only guard. Two failure modes matter and both are silent:
 *
 * - a name omp DOES implement over RPC gets refused, so a working command stops
 *   working in the chamber. That is why the table is asserted against omp's own
 *   registry rather than trusted, and why the predicate is name-only.
 * - a name omp does NOT implement slips through, which is the bug this module
 *   exists for: the prompt reaches the model as literal text and it improvises a
 *   turn around the string.
 */

import { describe, expect, test } from 'bun:test';

import { isTuiOnlySlashCommand, slashCommandName, tuiOnlyCommandNotice } from '@/shared/lib/chat/composer/tui-only';

describe('slashCommandName', () => {
  test('reads the token omp would dispatch on', () => {
    expect(slashCommandName('/plan')).toBe('plan');
    expect(slashCommandName('/PLAN')).toBe('plan');
    // Arguments, colon form, and leading whitespace all resolve to the name.
    expect(slashCommandName('/move /tmp/x')).toBe('move');
    expect(slashCommandName('/force:write')).toBe('force');
    expect(slashCommandName('   /clear')).toBe('clear');
  });

  test('a slash that is not a command is not a name', () => {
    expect(slashCommandName('fix a/b')).toBeNull();
    expect(slashCommandName('see /tmp/foo')).toBeNull();
    expect(slashCommandName('prose\n/plan')).toBeNull();
    expect(slashCommandName('/')).toBeNull();
    expect(slashCommandName('')).toBeNull();
  });
});

describe('isTuiOnlySlashCommand', () => {
  test('refuses the commands omp only implements in its TUI', () => {
    for (const command of ['/clear', '/new', '/login', '/hotkeys', '/tree', '/resume', '/quit', '/exit']) {
      expect(isTuiOnlySlashCommand(command)).toBe(true);
    }
    // Aliases count: omp resolves these to the same TUI-only entry.
    expect(isTuiOnlySlashCommand('/providers')).toBe(true);
    expect(isTuiOnlySlashCommand('/q')).toBe(true);
    expect(isTuiOnlySlashCommand('/status')).toBe(true);
    expect(isTuiOnlySlashCommand('/rewind')).toBe(true);
  });

  test('lets every command omp answers over RPC through', () => {
    // Sampled from the 42 entries carrying a text-mode `handle`; a false
    // positive here silently breaks a working command.
    for (const command of [
      '/model',
      '/context',
      '/usage',
      '/compact',
      '/todo',
      '/mcp list',
      '/rename x',
      '/move /tmp',
      '/session info',
      '/skill:diagnose',
      '/review',
    ]) {
      expect(isTuiOnlySlashCommand(command)).toBe(false);
    }
  });

  test('does NOT refuse a command Kabmo answers itself', () => {
    // `/btw` is TUI-only in omp, but Kabmo owns it: the composer opens
    // the side-question panel. Refusing it here broke a working feature.
    expect(isTuiOnlySlashCommand('/btw')).toBe(false);
    expect(isTuiOnlySlashCommand('/btw how does this work')).toBe(false);
  });

  test('does NOT refuse /plan or /goal, which Kabmo now owns', () => {
    // Both are `handleTui`-only in omp's registry, but Kabmo drives them
    // through its own extension inside the child — so a typed `/plan` or
    // `/goal` is a real command now, not literal text for the model to
    // improvise around. `plan-review` and `guided-goal` stay refused: neither
    // has a counterpart the extension can honour from a prompt.
    expect(isTuiOnlySlashCommand('/plan')).toBe(false);
    expect(isTuiOnlySlashCommand('/plan replace the queue')).toBe(false);
    expect(isTuiOnlySlashCommand('/goal')).toBe(false);
    expect(isTuiOnlySlashCommand('/goal Migrate the importer')).toBe(false);
    expect(isTuiOnlySlashCommand('/plan-review')).toBe(true);
    expect(isTuiOnlySlashCommand('/guided-goal make auth safer')).toBe(true);
  });

  test('ordinary prose is never a command', () => {
    expect(isTuiOnlySlashCommand('explain the plan')).toBe(false);
    expect(isTuiOnlySlashCommand('what does /clear do?')).toBe(false);
    expect(isTuiOnlySlashCommand('')).toBe(false);
  });
});

describe('tuiOnlyCommandNotice', () => {
  test('names the command and says where it works', () => {
    const notice = tuiOnlyCommandNotice('/plan do the thing');
    expect(notice).toContain('`/plan`');
    expect(notice).toContain('omp terminal only');
  });
});
