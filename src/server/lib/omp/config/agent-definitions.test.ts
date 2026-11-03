/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Native agent definitions: discovery, and the writer that edits omp's own
 * markdown files in place.
 *
 * The field set here is omp's contract, measured against the installed
 * `@oh-my-pi/pi-coding-agent` 18.16.0 (`discovery/helpers.ts`
 * `parseAgentFields`): `name`, `description`, `tools`, `spawns`, `model`,
 * `thinkingLevel`, and the body as the system prompt. Two failures are pinned:
 *
 *   - **A key omp ignores must not be offered or written.** `mode`,
 *     `temperature` and `top_p` are none of omp's business; a pane editing them
 *     changed a file to no effect.
 *   - **A write must not delete what it does not own.** A shipped agent's
 *     block-list `tools:`, its `spawns:` and its nested `output:` schema have to
 *     survive an edit to the prompt or the model.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deleteAgentDefinition, discoverNativeAgents, writeAgentDefinition } from '@/server/lib/omp/config/agents';

let root = '';
let agentDir = '';
let userAgents = '';
let projectAgents = '';
let prevAgentDir: string | undefined;

/** Write a fixture file, creating its parent directory. */
function write(file: string, content: string): string {
  fs.mkdirSync(join(file, '..'), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeAll(() => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-agent-definitions-'));
  agentDir = join(root, 'agent');
  userAgents = join(agentDir, 'agents');
  projectAgents = join(root, 'project-agents');
  fs.mkdirSync(userAgents, { recursive: true });
  fs.mkdirSync(projectAgents, { recursive: true });
  prevAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

beforeEach(() => {
  for (const dir of [userAgents, projectAgents]) {
    for (const entry of fs.readdirSync(dir)) fs.rmSync(join(dir, entry), { recursive: true, force: true });
  }
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterAll(() => {
  if (prevAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = prevAgentDir;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('discoverNativeAgents', () => {
  /**
   * Only the keys omp actually parses are surfaced. `mode` and `temperature`
   * are NOT among them (measured against 18.16.0 `parseAgentFields`), so a
   * panel that offered them was editing a file omp ignores.
   */
  test('shapes the frontmatter keys omp parses and skips non-markdown entries', async () => {
    write(join(userAgents, 'one.md'), [
      '---',
      'name: First',
      'description: "a description"',
      'model: kenari/deepseek-v4-flash',
      'thinking: high',
      'temperature: 0.5',
      'spawns: "*"',
      '---',
      '',
      '  system prompt  ',
      '',
    ].join('\n'));
    write(join(userAgents, 'two.md'), 'no frontmatter body\n');
    write(join(userAgents, 'ignored.txt'), 'x');
    fs.mkdirSync(join(userAgents, 'nested.md'), { recursive: true });

    const found = await discoverNativeAgents();
    expect(found.map((agent) => agent.id).sort()).toEqual(['omp-user-one', 'omp-user-two']);
    // By id, never by index: `readdir` order is not guaranteed (Windows returned `two` first).
    const byId = new Map(found.map((agent) => [agent.id, agent]));
    expect(byId.get('omp-user-one')).toMatchObject({
      name: 'First',
      description: 'a description',
      model: 'kenari/deepseek-v4-flash',
      thinkingLevel: 'high',
      spawns: '*',
      systemPrompt: 'system prompt',
      sourceRoot: 'user',
      filePath: join(userAgents, 'one.md'),
    });
    // `temperature` is not an agent key omp reads, so it is not carried.
    expect(byId.get('omp-user-one')).not.toHaveProperty('temperature');
    expect(byId.get('omp-user-two')).toMatchObject({
      name: 'two', description: '', systemPrompt: 'no frontmatter body',
    });
  });

  test('a model written as a block list is read, not missed', async () => {
    // omp writes `model:` as a YAML sequence (its own shipped agents do), which
    // a scalar-only frontmatter parser reads as an empty value.
    write(join(userAgents, 'block.md'), '---\nname: Block\nmodel:\n  - "@smol"\nthinkingLevel: medium\n---\nbody\n');
    const agent = (await discoverNativeAgents()).find((item) => item.id === 'omp-user-block');
    expect(agent).toMatchObject({ model: '@smol', thinkingLevel: 'medium' });
  });

  test('a user agent wins over a project agent with the same base name', async () => {
    write(join(userAgents, 'shared.md'), '---\nname: FromUser\n---\nuser body\n');
    write(join(projectAgents, 'shared.md'), '---\nname: FromProject\n---\nproject body\n');
    write(join(projectAgents, 'project-only.md'), '---\nname: OnlyProject\n---\nbody\n');

    const found = await discoverNativeAgents(projectAgents);
    expect(found.find((agent) => agent.filePath === join(userAgents, 'shared.md'))?.name).toBe('FromUser');
    expect(found.some((agent) => agent.filePath === join(projectAgents, 'shared.md'))).toBe(false);
    expect(found.find((agent) => agent.id === 'omp-project-project-only')?.sourceRoot).toBe('project');
  });

  test('an oversized definition is skipped and a missing directory is not an error', async () => {
    write(join(userAgents, 'huge.md'), `---\nname: Huge\n---\n${'x'.repeat(512 * 1024 + 1)}\n`);
    const found = await discoverNativeAgents();
    expect(found.some((agent) => agent.name === 'Huge')).toBe(false);
    expect(await discoverNativeAgents(join(root, 'no-such-dir'))).toEqual(found);
  });
});

describe('writeAgentDefinition', () => {
  test('refuses an unsafe file name and an empty system prompt', async () => {
    await expect(writeAgentDefinition({ fileName: '../escape', name: 'X', description: '', systemPrompt: 'x' }))
      .rejects.toThrow(/may contain letters/);
    await expect(writeAgentDefinition({ fileName: 'ok', name: 'X', description: '', systemPrompt: '   ' }))
      .rejects.toThrow(/cannot be empty/);
    expect(fs.existsSync(join(userAgents, 'ok.md'))).toBe(false);
  });

  test('writes the keys omp reads, quoting scalars, then deletes on request', async () => {
    const { path } = await writeAgentDefinition({
      fileName: 'written',
      name: 'Written Agent',
      description: 'has "quotes" and \\ slashes',
      model: 'kenari/deepseek-v4-flash',
      thinkingLevel: 'low',
      spawns: '*',
      tools: ['read', 'bash'],
      systemPrompt: 'do the thing',
    });
    expect(path).toBe(join(userAgents, 'written.md'));
    const text = fs.readFileSync(path, 'utf8');
    expect(text).toContain('name: "Written Agent"');
    expect(text).toContain('model: "kenari/deepseek-v4-flash"');
    expect(text).toContain('thinkingLevel: low');
    expect(text).toContain('spawns: "*"');
    expect(text).toContain('tools: read, bash');
    expect(text).toContain('has \\"quotes\\" and \\\\ slashes');
    // Keys omp ignores are never written: they would be dead config.
    expect(text).not.toContain('mode:');
    expect(text).not.toContain('temperature');
    expect(text).not.toContain('top_p');
    expect(text.endsWith('\n')).toBe(true);

    expect(await deleteAgentDefinition('written')).toBe(true);
    expect(await deleteAgentDefinition('written')).toBe(false);
    await expect(deleteAgentDefinition('bad/name')).rejects.toThrow(/Invalid agent file name/);
  });

  test('editing a shipped definition keeps the keys the panel does not own', async () => {
    // A real omp agent file: a tools block list, an `output:` schema, and a key
    // order the panel has no business rewriting.
    write(join(userAgents, 'shipped.md'), [
      '---',
      'name: shipped',
      'description: "Ship it"',
      'tools:',
      '  - read',
      '  - grep',
      'model:',
      '  - "@smol"',
      'thinkingLevel: medium',
      'output:',
      '  properties:',
      '    summary:',
      '      type: string',
      '---',
      '',
      'old prompt',
      '',
    ].join('\n'));

    await writeAgentDefinition({
      fileName: 'shipped',
      name: 'shipped',
      description: 'Ship it',
      model: 'kenari/deepseek-v4-flash',
      thinkingLevel: 'high',
      systemPrompt: 'new prompt',
    });

    const text = fs.readFileSync(join(userAgents, 'shipped.md'), 'utf8');
    // Preserved verbatim: the panel never touched them.
    expect(text).toContain('tools:\n  - read\n  - grep\n');
    expect(text).toContain('output:\n  properties:\n    summary:\n      type: string\n');
    // Replaced where it stood, so a stale `model:` block list cannot survive.
    expect(text).toContain('model: "kenari/deepseek-v4-flash"');
    expect(text).toContain('thinkingLevel: high');
    expect(text).not.toContain('"@smol"');
    expect(text).toContain('new prompt');
    expect(text).not.toContain('old prompt');
    // One name and one description, never a duplicate appended below.
    expect(text.match(/^name:/gm)).toHaveLength(1);
    expect(text.match(/^description:/gm)).toHaveLength(1);
  });

  test('an untouched tools field leaves the block list exactly as it was', async () => {
    // The pane's tools box is a CSV view of a YAML list. Re-sending the same
    // names as CSV rewrote four lines into one, which is a silent reformat of a
    // file the user never edited.
    const original = [
      '---',
      'name: keep',
      'description: "Keep the list"',
      'tools:',
      '  - read',
      '  - grep',
      '---',
      '',
      'body',
      '',
    ].join('\n');
    write(join(userAgents, 'keep.md'), original);

    await writeAgentDefinition({
      fileName: 'keep',
      name: 'keep',
      description: 'Keep the list',
      systemPrompt: 'new body',
    });

    const text = fs.readFileSync(join(userAgents, 'keep.md'), 'utf8');
    expect(text).toContain('tools:\n  - read\n  - grep\n');
    expect(text).toContain('new body');
  });

  test('clearing the model removes the key so omp falls back to the role default', async () => {
    await writeAgentDefinition({
      fileName: 'clear',
      name: 'clear',
      description: '',
      model: 'kenari/deepseek-v4-flash',
      systemPrompt: 'body',
    });
    await writeAgentDefinition({
      fileName: 'clear',
      name: 'clear',
      description: '',
      model: '',
      systemPrompt: 'body',
    });
    const text = fs.readFileSync(join(userAgents, 'clear.md'), 'utf8');
    expect(text).not.toContain('model:');
  });
});
