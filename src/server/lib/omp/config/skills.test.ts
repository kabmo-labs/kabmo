/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Chamber-managed SKILL.md authoring: which root a scope writes into, what a
 * move between roots leaves behind, and what a save does to the file body.
 *
 * The move is the case worth locking: a rename or a user⇄project move once left
 * the source directory in place, so one skill existed twice and omp could load
 * whichever it walked into first. A save is the other: the body is read back
 * with the frontmatter's blank separator removed and written with trailing
 * whitespace trimmed, so reading and re-saving must be a no-op.
 *
 * `PI_CODING_AGENT_DIR` is redirected to a temp dir, so the real
 * `~/.omp/agent/skills` is never written.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { readSkillFile, writeSkillFile } from '@/server/lib/omp/config/skills';

let projectDir = '';
let agentDir = '';
let realAgentDir: string | undefined;

beforeAll(() => {
  projectDir = fs.mkdtempSync(join(tmpdir(), 'kabmo-skill-project-'));
  agentDir = fs.mkdtempSync(join(tmpdir(), 'kabmo-skill-agent-'));
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  fs.rmSync(projectDir, { recursive: true, force: true });
  fs.rmSync(agentDir, { recursive: true, force: true });
});

const body = `---
description: "a skill"
---

do the thing
`;

describe('writeSkillFile', () => {
  test('a project write lands under the workspace .omp/skills', async () => {
    const { filePath } = await writeSkillFile({
      scope: 'project',
      projectDir,
      name: 'proj-skill',
      description: 'a skill',
      hidden: false,
      body,
    });
    expect(filePath).toBe(join(projectDir, '.omp', 'skills', 'proj-skill', 'SKILL.md'));
    expect(await readSkillFile(filePath)).toEqual({ description: 'a skill', body: body, hidden: false });
  });

  test('re-saving what was read does not grow the file', async () => {
    // Written here, not taken from the case above: the file this re-saves must
    // not depend on which case ran first.
    const filePath = join(projectDir, '.omp', 'skills', 'proj-skill', 'SKILL.md');
    await writeSkillFile({ scope: 'project', projectDir, name: 'proj-skill', description: 'a skill', hidden: false, body: 'the body\n' });
    const first = fs.readFileSync(filePath, 'utf8');
    const parsed = await readSkillFile(filePath);
    await writeSkillFile({
      scope: 'project',
      projectDir,
      name: 'proj-skill',
      description: parsed!.description,
      hidden: parsed!.hidden,
      body: parsed!.body,
    });
    expect(fs.readFileSync(filePath, 'utf8')).toBe(first);
  });

  test('a move between scopes removes the source, leaving one skill', async () => {
    const moved = await writeSkillFile({
      scope: 'user',
      projectDir,
      previousDir: join(projectDir, '.omp', 'skills', 'proj-skill'),
      name: 'proj-skill',
      description: 'a skill',
      hidden: false,
      body,
    });
    expect(moved.filePath).toBe(join(agentDir, 'skills', 'proj-skill', 'SKILL.md'));
    expect(fs.existsSync(join(projectDir, '.omp', 'skills', 'proj-skill'))).toBe(false);
    expect(fs.existsSync(moved.filePath)).toBe(true);
  });

  test('a project write with no workspace is refused', () => {
    expect(writeSkillFile({ scope: 'project', name: 'lost', description: 'd', hidden: false, body: 'b' }))
      .rejects.toThrow('workspace root is required to write a project skill');
  });

  test('a name that is not a single directory is refused', () => {
    expect(writeSkillFile({ scope: 'project', projectDir, name: '../escape', description: 'd', hidden: false, body: 'b' }))
      .rejects.toThrow('path separator');
  });
});
