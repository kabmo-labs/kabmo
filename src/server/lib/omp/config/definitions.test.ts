/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The definition files Kabmo owns (agents, instruction files) and the plugin CLI wrapper. Agent discovery is read-only and forgiving: a malformed
 * frontmatter field becomes a default (`mode: all`, `temperature: null`) rather
 * than dropping the agent, a non-`.md` entry and an oversized file are skipped,
 * and a USER agent wins over a project agent with the same base name.
 * `writeAgentDefinition` is the only writer — it refuses a name that escapes the
 * agents directory and an empty prompt, and emits exactly the frontmatter keys
 * omp reads (`thinking-level`, `top_p`) with quoted scalars. An instruction file
 * of only whitespace REMOVES the file, or an empty AGENTS.md would still claim
 * the context scope; plugin wrappers pass `--scope` only where omp accepts it,
 * and `pluginCliError` prefers stderr. `PI_CODING_AGENT_DIR` points at a temp
 * dir and `KABMO_OMP_BIN` at a stub recording its argv — no real process (the stub is a compiled executable, so it spawns on both platforms).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { executableStub, OMP_ARGV_LOG_STUB_SOURCE } from '@/test-support/executable-stub';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deleteAgentDefinition, discoverNativeAgents, writeAgentDefinition } from '@/server/lib/omp/config/agents';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import {
  clearInstructionFile,
  getInstructionFilePath,
  isInstructionFileKind,
  readInstructionFile,
  saveInstructionFile,
} from '@/server/lib/omp/config/instructions';
import { pluginCliError } from '@/server/lib/omp/config/plugin-cli';
import {
  addMarketplace,
  deletePluginSetting,
  installPlugin,
  removeMarketplace,
  runPluginDoctor,
  setPluginEnabled,
  setPluginFeatures,
  setPluginSetting,
  uninstallPlugin,
  updateMarketplaces,
  upgradePlugins,
} from '@/server/lib/omp/config/plugin-actions';
import {
  installCatalogSkill,
  searchSkillCatalog,
  toCatalogSkills,
  uninstallCatalogSkill,
} from '@/server/lib/omp/config/skills-catalog';

let root = '';
let agentDir = '';
let userAgents = '';
let projectAgents = '';
let logFile = '';
let prevAgentDir: string | undefined;
let prevBin: string | undefined;
let prevMock: string | undefined;

/** Write a fixture file, creating its parent directory. */
function write(file: string, content: string): string {
  fs.mkdirSync(join(file, '..'), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeAll(async () => {
  root = fs.mkdtempSync(join(tmpdir(), 'kabmo-definitions-'));
  agentDir = join(root, 'agent');
  userAgents = join(agentDir, 'agents');
  projectAgents = join(root, 'project-agents');
  fs.mkdirSync(userAgents, { recursive: true });
  fs.mkdirSync(projectAgents, { recursive: true });
  prevAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  prevBin = Bun.env.KABMO_OMP_BIN;
  prevMock = Bun.env.MOCK;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  Bun.env.MOCK = 'true';

  logFile = join(root, 'argv.log');
  Bun.env.FAKE_OMP_ARGV_LOG = logFile;
  Bun.env.KABMO_OMP_BIN = await executableStub(OMP_ARGV_LOG_STUB_SOURCE, 'fake-omp-argv');
  // `resolveOmpBin` memoizes the FIRST binary it resolves for the process.
  invalidateOmpCliCache();
});

// Each case writes its own fixtures here; clear first, or a shuffled run lets
// one case's files (and the process-wide env / memoized binary) decide another's.
beforeEach(() => {
  for (const dir of [userAgents, projectAgents]) {
    for (const entry of fs.readdirSync(dir)) fs.rmSync(join(dir, entry), { recursive: true, force: true });
  }
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  invalidateOmpCliCache();
});

afterAll(() => {
  if (prevAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = prevAgentDir;
  if (prevBin === undefined) delete Bun.env.KABMO_OMP_BIN;
  else Bun.env.KABMO_OMP_BIN = prevBin;
  delete Bun.env.FAKE_OMP_ARGV_LOG;
  invalidateOmpCliCache();
  if (prevMock === undefined) delete Bun.env.MOCK;
  else Bun.env.MOCK = prevMock;
  fs.rmSync(root, { recursive: true, force: true });
});

describe('discoverNativeAgents', () => {
  test('shapes frontmatter, defaults malformed fields, and skips non-markdown entries', async () => {
    write(join(userAgents, 'one.md'), [
      '---',
      'name: First',
      'description: "a description"',
      'mode: subagent',
      'model: fast',
      'thinking: high',
      'temperature: 0.5',
      'top_p: nope',
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
      name: 'First', description: 'a description', mode: 'subagent', overrideModel: 'fast', thinkingVariant: 'high',
      temperature: 0.5, topP: null, systemPrompt: 'system prompt', sourceRoot: 'user', filePath: join(userAgents, 'one.md'),
    });
    expect(byId.get('omp-user-two')).toMatchObject({
      name: 'two', description: '', mode: 'all', temperature: null, topP: null, systemPrompt: 'no frontmatter body',
    });
  });

  test('an unrecognized mode and a non-numeric temperature degrade to defaults', async () => {
    write(join(userAgents, 'weird.md'), '---\nmode: wizard\ntemperature: hot\n---\nbody\n');
    const agent = (await discoverNativeAgents()).find((item) => item.id === 'omp-user-weird');
    expect(agent).toMatchObject({ mode: 'all', temperature: null });
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
    await expect(writeAgentDefinition({ fileName: '../escape', systemPrompt: 'x' })).rejects.toThrow(/may contain letters/);
    await expect(writeAgentDefinition({ fileName: 'ok', systemPrompt: '   ' })).rejects.toThrow(/cannot be empty/);
    expect(fs.existsSync(join(userAgents, 'ok.md'))).toBe(false);
  });

  test('writes omp frontmatter keys, quoting scalars, then deletes on request', async () => {
    const { path } = await writeAgentDefinition({
      fileName: 'written',
      description: 'has "quotes" and \\ slashes',
      mode: 'primary',
      thinking: 'low',
      temperature: 0.2,
      topP: 0.9,
      tools: ['read', 'bash'],
      systemPrompt: 'do the thing',
    });
    expect(path).toBe(join(userAgents, 'written.md'));
    const text = fs.readFileSync(path, 'utf8');
    expect(text).toContain('name: "written"');
    expect(text).toContain('mode: "primary"');
    expect(text).toContain('thinking-level: "low"');
    expect(text).toContain('temperature: 0.2');
    expect(text).toContain('top_p: 0.9');
    expect(text).toContain('tools: "read", "bash"');
    expect(text).toContain('has \\"quotes\\" and \\\\ slashes');
    expect(text.endsWith('\n')).toBe(true);

    expect(await deleteAgentDefinition('written')).toBe(true);
    expect(await deleteAgentDefinition('written')).toBe(false);
    await expect(deleteAgentDefinition('bad/name')).rejects.toThrow(/Invalid agent file name/);
  });
});

describe('instruction files', () => {
  test('narrows the kind and resolves the two omp basenames', () => {
    expect(isInstructionFileKind('agents')).toBe(true);
    expect(isInstructionFileKind('rules')).toBe(true);
    expect(isInstructionFileKind('AGENTS.md')).toBe(false);
    expect(isInstructionFileKind(undefined)).toBe(false);
    expect(getInstructionFilePath('agents')).toBe(join(agentDir, 'AGENTS.md'));
    expect(getInstructionFilePath('rules')).toBe(join(agentDir, 'RULES.md'));
  });

  test('a missing file is a state, and a save round-trips through the same path', async () => {
    expect(await readInstructionFile('rules')).toEqual({
      kind: 'rules',
      path: join(agentDir, 'RULES.md'),
      content: '',
      exists: false,
    });

    const saved = await saveInstructionFile('rules', 'be brief\n');
    expect(saved).toMatchObject({ exists: true, content: 'be brief\n' });
    expect(await readInstructionFile('rules')).toEqual(saved);
  });

  test('whitespace-only content removes the file rather than leaving it empty', async () => {
    await saveInstructionFile('agents', 'something');
    expect(await saveInstructionFile('agents', '   \n\t')).toEqual({
      kind: 'agents',
      path: join(agentDir, 'AGENTS.md'),
      content: '',
      exists: false,
    });
    expect(fs.existsSync(join(agentDir, 'AGENTS.md'))).toBe(false);
    expect(await clearInstructionFile('agents')).toMatchObject({ exists: false, content: '' });
  });

  test('an oversized file is refused instead of buffered', async () => {
    const filePath = join(agentDir, 'AGENTS.md');
    write(filePath, 'x'.repeat(1024 * 1024 + 1));
    await expect(readInstructionFile('agents')).rejects.toThrow(/larger than/);
  });
});

describe('plugin action scope flags', () => {
  /** Run one wrapper against the stub binary and return the argv it received. */
  async function recorded(call: () => Promise<unknown>): Promise<string[]> {
    await call();
    // Only the stub's trailing newline is dropped, so an intentionally empty
    // argument (e.g. `--set ""`) survives as an empty entry.
    return fs.readFileSync(logFile, 'utf8').replace(/\n$/, '').split('\n').slice(1);
  }

  test('install, uninstall and enable/disable carry --scope only when one is given', async () => {
    expect(await recorded(() => installPlugin('pkg@1', root, 'project'))).toEqual(['install', 'pkg@1', '--scope', 'project']);
    expect(await recorded(() => installPlugin('pkg@1', root))).toEqual(['install', 'pkg@1']);
    expect(await recorded(() => uninstallPlugin('pkg', root, 'user'))).toEqual(['uninstall', 'pkg', '--scope', 'user']);
    expect(await recorded(() => setPluginEnabled('pkg', true, root, 'user'))).toEqual(['enable', 'pkg', '--scope', 'user']);
    expect(await recorded(() => setPluginEnabled('pkg', false, root))).toEqual(['disable', 'pkg']);
  });

  test('upgrade passes its scope only alongside a named plugin', async () => {
    expect(await recorded(() => upgradePlugins('pkg', root, 'project'))).toEqual(['upgrade', 'pkg', '--scope', 'project']);
    expect(await recorded(() => upgradePlugins(null, root, 'project'))).toEqual(['upgrade']);
    expect(await recorded(() => upgradePlugins(null, root))).toEqual(['upgrade']);
  });

  test('features replace the selection outright, and settings are addressed by package name', async () => {
    expect(await recorded(() => setPluginFeatures('@local/pkg', ['a', 'b'], root))).toEqual([
      'features',
      '@local/pkg',
      '--set',
      'a,b',
    ]);
    expect(await recorded(() => setPluginFeatures('@local/pkg', [], root))).toEqual(['features', '@local/pkg', '--set', '']);
    expect(await recorded(() => setPluginSetting('@local/pkg', 'apiKey', 'v', root))).toEqual([
      'config',
      'set',
      '@local/pkg',
      'apiKey',
      'v',
    ]);
    expect(await recorded(() => deletePluginSetting('@local/pkg', 'apiKey', root))).toEqual([
      'config',
      'delete',
      '@local/pkg',
      'apiKey',
    ]);
  });

  test('marketplace verbs take no scope, and doctor always asks for json', async () => {
    expect(await recorded(() => addMarketplace('https://github.com/a/b', root))).toEqual(['marketplace', 'add', 'https://github.com/a/b']);
    expect(await recorded(() => removeMarketplace('mkt', root))).toEqual(['marketplace', 'remove', 'mkt']);
    expect(await recorded(() => updateMarketplaces('mkt', root))).toEqual(['marketplace', 'update', 'mkt']);
    expect(await recorded(() => updateMarketplaces(null, root))).toEqual(['marketplace', 'update']);
    expect(await recorded(() => runPluginDoctor(root))).toEqual(['doctor', '--json']);
  });
});

describe('pluginCliError', () => {
  test('prefers stderr, strips the status glyph, and keeps @scope paths intact', () => {
    expect(pluginCliError({ ok: false, stdout: 'ignored', stderr: '✖ Failed to install x@y: not found\n' }))
      .toBe('Failed to install x@y: not found');
    expect(pluginCliError({ ok: false, stdout: 'stdout only\n', stderr: '   ' })).toBe('stdout only');
    expect(pluginCliError({ ok: false, stdout: '', stderr: 'warning\n\n!! @scope/pkg failed\n\n' }))
      .toBe('@scope/pkg failed');
    expect(pluginCliError({ ok: false, stdout: '', stderr: '' })).toBe('omp plugin command failed');
  });
});

describe('skills catalog', () => {
  test('search degrades to an empty list in mock mode, and results map to the UI contract', async () => {
    expect(await searchSkillCatalog('anything')).toEqual([]);
    expect(toCatalogSkills([
      { package: 'owner/repo', name: 'Repo Skill', source: 'owner/repo', installs: 12 },
      { package: 'other/thing', name: 'Thing', source: '', installs: 0 },
    ], 'skills.sh')).toEqual([
      {
        id: 'catalog-owner/repo',
        sourceId: 'skills.sh',
        name: 'Repo Skill',
        description: 'From owner/repo',
        repoTag: 'owner/repo',
        githubUrl: 'https://github.com/owner/repo',
        instructions: 'owner/repo',
      },
      {
        id: 'catalog-other/thing',
        sourceId: 'skills.sh',
        name: 'Thing',
        description: '',
        repoTag: 'other/thing',
        githubUrl: undefined,
        instructions: 'other/thing',
      },
    ]);
  });

  test('rejects malformed input, and refuses a valid install in mock mode without spawning bunx', async () => {
    await expect(installCatalogSkill('not-a-package')).rejects.toThrow(/Invalid skill package/);
    await expect(uninstallCatalogSkill('bad name!')).rejects.toThrow(/Invalid skill name/);
    await expect(installCatalogSkill('owner/repo')).rejects.toThrow(/unavailable in mock mode/);
    await expect(uninstallCatalogSkill('some-skill')).rejects.toThrow(/unavailable in mock mode/);
  });
});
