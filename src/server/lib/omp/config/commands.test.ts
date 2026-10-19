/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Command-file location and authoring.
 *
 * `get_available_commands` reports a command's name, description and hint but
 * never the file behind it, so the pane's read-only/editable decision and the
 * delete's safety both rest on this lookup. The rules worth locking are the
 * ones a user cannot see: which root a duplicate name resolves to (omp runs the
 * PROJECT file), which roots Kabmo may write to (only the two
 * `omp`-native ones), and the `.prompt.md` suffix VS Code prompt files carry.
 *
 * Everything runs inside a temp workspace and a temp `$HOME`, so the real
 * `~/.omp/agent/commands` is never read or written.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  deleteCommandFile,
  locateCommandFile,
  readCommandFile,
  writeCommandFile,
} from '@/server/lib/omp/config/commands';

let projectDir = '';
let homeDir = '';
let realHome: string | undefined;

const write = (filePath: string, body = 'body') => {
  fs.mkdirSync(join(filePath, '..'), { recursive: true });
  fs.writeFileSync(filePath, body);
};

beforeAll(() => {
  projectDir = fs.mkdtempSync(join(tmpdir(), 'kabmo-cmd-project-'));
  homeDir = fs.mkdtempSync(join(tmpdir(), 'kabmo-cmd-home-'));
  realHome = Bun.env.HOME;
  // `userCommandDirs()` reads `$HOME` for the `.claude`/`.codex`/`.agents`/
  // `.config/opencode` roots, so redirecting it keeps the test off the real one.
  Bun.env.HOME = homeDir;
});

afterAll(() => {
  if (realHome === undefined) delete Bun.env.HOME;
  else Bun.env.HOME = realHome;
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(homeDir, { recursive: true, force: true });
});

describe('locateCommandFile', () => {
  test('a workspace .omp/commands file is the managed project root', async () => {
    write(join(projectDir, '.omp', 'commands', 'proj.md'));
    expect(await locateCommandFile('proj', projectDir)).toEqual({
      filePath: join(projectDir, '.omp', 'commands', 'proj.md'),
      scope: 'project',
      managed: true,
    });
  });

  test("another tool's file is found but never managed", async () => {
    write(join(projectDir, '.claude', 'commands', 'claude-cmd.md'));
    expect(await locateCommandFile('claude-cmd', projectDir)).toEqual({
      filePath: join(projectDir, '.claude', 'commands', 'claude-cmd.md'),
      scope: 'project',
      managed: false,
    });
  });

  test('a prompt file is found under its .prompt.md suffix', async () => {
    write(join(projectDir, '.github', 'prompts', 'copilot.prompt.md'));
    expect((await locateCommandFile('copilot', projectDir))?.filePath)
      .toBe(join(projectDir, '.github', 'prompts', 'copilot.prompt.md'));
  });

  test('a duplicate name resolves to the project file', async () => {
    write(join(homeDir, '.claude', 'commands', 'dupe.md'));
    write(join(projectDir, '.omp', 'commands', 'dupe.md'));
    expect((await locateCommandFile('dupe', projectDir))?.filePath)
      .toBe(join(projectDir, '.omp', 'commands', 'dupe.md'));
    // With no workspace the same name is the user-level file, which the
    // Kabmo does not own.
    expect(await locateCommandFile('dupe')).toEqual({
      filePath: join(homeDir, '.claude', 'commands', 'dupe.md'),
      scope: 'user',
      managed: false,
    });
  });

  test('a name that is not a plain file name is refused', async () => {
    expect(await locateCommandFile('../escape', projectDir)).toBeNull();
    expect(await locateCommandFile('nested/name', projectDir)).toBeNull();
    expect(await locateCommandFile('   ', projectDir)).toBeNull();
  });

  test('a builtin has no file at all', async () => {
    expect(await locateCommandFile('model', projectDir)).toBeNull();
  });
});

describe('writeCommandFile / deleteCommandFile', () => {
  test('round-trips a project command through the file', async () => {
    const { filePath } = await writeCommandFile({
      scope: 'project',
      projectDir,
      name: 'round',
      description: 'round trip',
      argumentHint: '[a|b]',
      body: 'do $ARGUMENTS',
    });
    expect(filePath).toBe(join(projectDir, '.omp', 'commands', 'round.md'));
    // The parsed body carries the trailing newline the serializer emits, and
    // the leading blank line that separates it from the frontmatter is dropped.
    expect(await readCommandFile(filePath)).toEqual({
      description: 'round trip',
      argumentHint: '[a|b]',
      body: 'do $ARGUMENTS\n',
    });
    // Saving what was read must not grow the file: the pane posts exactly this.
    const first = fs.readFileSync(filePath, 'utf8');
    const parsed = await readCommandFile(filePath);
    await writeCommandFile({
      scope: 'project',
      projectDir,
      name: 'round',
      description: parsed!.description,
      argumentHint: parsed!.argumentHint,
      body: parsed!.body,
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(first);
    expect(await deleteCommandFile('round', projectDir)).toBe(true);
    expect(await locateCommandFile('round', projectDir)).toBeNull();
  });

  test('a rename moves the file instead of leaving two', async () => {
    await writeCommandFile({ scope: 'project', projectDir, name: 'before', description: 'd', argumentHint: '', body: 'b' });
    await writeCommandFile({
      scope: 'project',
      projectDir,
      previousName: 'before',
      name: 'after',
      description: 'd',
      argumentHint: '',
      body: 'b',
    });
    expect(await locateCommandFile('before', projectDir)).toBeNull();
    expect(await locateCommandFile('after', projectDir)).not.toBeNull();
    await deleteCommandFile('after', projectDir);
  });

  test('a project write with no workspace is refused', async () => {
    expect(writeCommandFile({ scope: 'project', name: 'lost', description: 'd', argumentHint: '', body: 'b' }))
      .rejects.toThrow('workspace root is required');
  });

  test("a delete cannot reach a file another tool installed", async () => {
    write(join(projectDir, '.claude', 'commands', 'notours.md'));
    expect(deleteCommandFile('notours', projectDir)).rejects.toThrow('cannot delete');
    expect(fs.existsSync(join(projectDir, '.claude', 'commands', 'notours.md'))).toBe(true);
  });
});
