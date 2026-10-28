/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The file-backed native OMP config readers/writers, pinned over a temp agent
 * dir (PI_CODING_AGENT_DIR) so no real ~/.omp is touched.
 *
 * The risky behavior each block locks:
 * - `yaml.ts` frontmatter parsing: an indented nested block (e.g. a JSON
 *   `output:` schema) must NOT leak keys into the top-level map, and quoted
 *   values are unquoted; a document without frontmatter is body-only.
 * - `models-config.ts`: `models.yml` wins over the legacy `models.yaml`, and a
 *   map-form `models` is reported as an EMPTY list rather than being flattened
 *   (flattening it is what omp rejects).
 * - `roles.ts` / `extensions.ts` / `behavior.ts`: writes preserve unrelated
 *   keys, invalid ids are rejected, and only the parsed fields are touched.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { asMapping, getOmpConfigPath, parseFrontmatter } from '@/server/lib/omp/config/yaml';
import { getModelsConfigPath, readNativeProviders } from '@/server/lib/omp/config/models-config';
import { readModelRoles, writeModelRoles } from '@/server/lib/omp/config/roles';
import { discoverExtensions, readDisabledExtensions, setExtensionDisabled } from '@/server/lib/omp/config/extensions';
import { parseApprovalRules, writeToolsApproval } from '@/server/lib/omp/config/behavior';

const originalAgentDir = Bun.env.PI_CODING_AGENT_DIR;
const roots: string[] = [];

/** Fresh temp agent dir, installed as the override for the current test. */
async function freshAgentDir(): Promise<string> {
  const root = await fs.promises.mkdtemp(join(tmpdir(), 'omp-config-'));
  roots.push(root);
  const agent = join(root, 'agent');
  await fs.promises.mkdir(agent, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = agent;
  return agent;
}

afterAll(async () => {
  if (originalAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
  for (const root of roots) await fs.promises.rm(root, { recursive: true, force: true });
});

describe('yaml', () => {
  test('asMapping returns the record and rejects non-mappings by path', () => {
    expect(asMapping({ a: 1 }, '/x/config.yml')).toEqual({ a: 1 });
    for (const bad of [[], 'text', 3, null, undefined]) {
      expect(() => asMapping(bad, '/x/config.yml')).toThrow('/x/config.yml must contain a YAML mapping');
    }
  });

  test('parseFrontmatter keeps only top-level keys and unquotes values', () => {
    const text = '---\ntitle: "Hi"\ncount: 3\noutput:\n  type: object\n---\nBody\n';
    // The nested block's own lines are dropped, but its top-level parent key
    // stays with an empty value (it is a top-level key, not a nested one).
    expect(parseFrontmatter(text)).toEqual({ data: { title: 'Hi', count: '3', output: '' }, body: 'Body\n' });
  });

  test('parseFrontmatter treats a document without a block as body-only', () => {
    expect(parseFrontmatter('plain body')).toEqual({ data: {}, body: 'plain body' });
    // Not at the very start: no frontmatter, the whole text is the body.
    expect(parseFrontmatter(' lead\n---\na: 1\n---\n')).toEqual({ data: {}, body: ' lead\n---\na: 1\n---\n' });
  });

  test('parseFrontmatter skips colon-less and empty-key lines and accepts CRLF', () => {
    expect(parseFrontmatter('---\nnoColon\n: bad\nok: 1\r\n---\r\nrest')).toEqual({
      data: { ok: '1' },
      body: 'rest',
    });
  });

  test('getOmpConfigPath points at <agent>/config.yml', async () => {
    const agent = await freshAgentDir();
    expect(getOmpConfigPath()).toBe(join(agent, 'config.yml'));
  });
});

describe('models-config', () => {
  test('getModelsConfigPath prefers models.yml and falls back to legacy models.yaml', async () => {
    const agent = await freshAgentDir();
    expect(await getModelsConfigPath()).toBe(join(agent, 'models.yml'));

    await Bun.write(join(agent, 'models.yaml'), 'providers: {}\n');
    expect(await getModelsConfigPath()).toBe(join(agent, 'models.yaml'));

    await Bun.write(join(agent, 'models.yml'), 'providers: {}\n');
    expect(await getModelsConfigPath()).toBe(join(agent, 'models.yml'));
  });

  test('readNativeProviders returns [] when the file is missing', async () => {
    await freshAgentDir();
    expect(await readNativeProviders()).toEqual([]);
  });

  test('readNativeProviders shapes providers and their models', async () => {
    const agent = await freshAgentDir();
    await Bun.write(join(agent, 'models.yml'), [
      'providers:',
      '  deepseek:',
      '    baseUrl: https://api.deepseek.com',
      '    api: openai-completions',
      '    auth: none',
      '    models:',
      '      - id: deepseek-chat',
      '        name: DeepSeek Chat',
      '        contextWindow: 64000',
      '        maxTokens: 8192',
      '        reasoning: true',
      '        input: [text, image]',
      '  ollama:',
      '    discovery:',
      '      type: ollama',
      '',
    ].join('\n'));

    const providers = await readNativeProviders();
    expect(providers.map((p) => p.slug)).toEqual(['deepseek', 'ollama']);
    expect(providers[0]).toEqual({
      slug: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      auth: 'none',
      modelIds: ['deepseek-chat'],
      models: [{
        id: 'deepseek-chat',
        name: 'DeepSeek Chat',
        contextWindow: 64000,
        maxTokens: 8192,
        reasoning: true,
        imageInput: true,
      }],
    });
    expect(providers[1]).toEqual({ slug: 'ollama', discovery: 'ollama', modelIds: [], models: [] });
  });

  test('readNativeProviders refuses to flatten a map-form models entry', async () => {
    const agent = await freshAgentDir();
    await Bun.write(join(agent, 'models.yml'), [
      'providers:',
      '  broken:',
      '    baseUrl: https://x',
      '    models:',
      '      a:',
      '        name: A',
      '',
    ].join('\n'));
    expect(await readNativeProviders()).toEqual([
      { slug: 'broken', baseUrl: 'https://x', modelIds: [], models: [] },
    ]);
  });

  test('readNativeProviders returns [] on malformed YAML or a non-record root', async () => {
    const agent = await freshAgentDir();
    await Bun.write(join(agent, 'models.yml'), 'providers: [unclosed\n');
    expect(await readNativeProviders()).toEqual([]);
    await Bun.write(join(agent, 'models.yml'), '- just\n- a\n- list\n');
    expect(await readNativeProviders()).toEqual([]);
  });
});

describe('roles', () => {
  test('readModelRoles is empty without a file or a record modelRoles', async () => {
    const agent = await freshAgentDir();
    expect((await readModelRoles()).roles).toEqual({});

    await Bun.write(join(agent, 'config.yml'), 'modelRoles: nope\n');
    expect((await readModelRoles()).roles).toEqual({});

    await Bun.write(join(agent, 'config.yml'), 'modelRoles:\n  advisor: "x/y"\n  broken: 7\n');
    expect((await readModelRoles()).roles).toEqual({ advisor: 'x/y' });
  });

  test('writeModelRoles replaces modelRoles and preserves unrelated keys', async () => {
    const agent = await freshAgentDir();
    await Bun.write(join(agent, 'config.yml'), 'theme: dark\nmodelRoles:\n  old: a/b\n');
    await writeModelRoles({ advisor: 'openai/gpt-5' });

    expect(Bun.YAML.parse(await fs.promises.readFile(join(agent, 'config.yml'), 'utf8'))).toEqual({
      theme: 'dark',
      modelRoles: { advisor: 'openai/gpt-5' },
    });
  });
});

describe('extensions', () => {
  test('discoverExtensions scans user and project roots, user name wins', async () => {
    const agent = await freshAgentDir();
    const project = join(agent, '..', 'project');
    await fs.promises.mkdir(join(agent, 'extensions'), { recursive: true });
    await fs.promises.mkdir(join(project, '.omp', 'extensions'), { recursive: true });
    await Bun.write(join(agent, 'extensions', 'shared.ts'), 'export {};');
    await Bun.write(join(agent, 'extensions', 'ignored.txt'), 'x');
    await Bun.write(join(project, '.omp', 'extensions', 'shared.ts'), 'export {};');
    await Bun.write(join(project, '.omp', 'extensions', 'proj.mjs'), 'export {};');

    const found = await discoverExtensions(project);
    const byName = Object.fromEntries(found.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(['proj', 'shared']);
    expect(byName.shared.sourceRoot).toBe('user');
    expect(byName.proj.sourceRoot).toBe('project');
    expect(byName.shared.id).toBe('extension-module:shared');
    expect(byName.proj.filePath).toBe(join(project, '.omp', 'extensions', 'proj.mjs'));
  });

  test('readDisabledExtensions returns only string ids and swallows bad YAML', async () => {
    const agent = await freshAgentDir();
    expect(await readDisabledExtensions()).toEqual(new Set());

    await Bun.write(join(agent, 'config.yml'), 'disabledExtensions: [skill:a, 7, null]\n');
    expect(await readDisabledExtensions()).toEqual(new Set(['skill:a']));

    await Bun.write(join(agent, 'config.yml'), 'disabledExtensions: {not: a-list}\n');
    expect(await readDisabledExtensions()).toEqual(new Set());

    await Bun.write(join(agent, 'config.yml'), ': : not yaml [\n');
    expect(await readDisabledExtensions()).toEqual(new Set());
  });

  test('setExtensionDisabled rejects a malformed id before touching the file', async () => {
    const agent = await freshAgentDir();
    await expect(setExtensionDisabled('has space', true)).rejects.toThrow('Invalid extension id');
    expect(await Bun.file(join(agent, 'config.yml')).exists()).toBe(false);
  });

  test('setExtensionDisabled adds an id to a file with no list yet', async () => {
    const agent = await freshAgentDir();
    const configPath = join(agent, 'config.yml');
    await Bun.write(configPath, 'theme: dark\n');
    expect(await setExtensionDisabled('skill:a', true)).toBe(true);
    // Bun.file memoizes across the external rename, so re-read through fs.
    expect(Bun.YAML.parse(await fs.promises.readFile(configPath, 'utf8'))).toEqual({
      theme: 'dark',
      disabledExtensions: ['skill:a'],
    });
  });

  test('enabling an id that was never disabled is a no-op', async () => {
    const agent = await freshAgentDir();
    const configPath = join(agent, 'config.yml');
    await Bun.write(configPath, 'theme: dark\n');
    expect(await setExtensionDisabled('skill:a', false)).toBe(false);
    expect(await fs.promises.readFile(configPath, 'utf8')).toBe('theme: dark\n');
  });
});

describe('behavior rules', () => {
  test('parseApprovalRules maps the phrasing to omp approval values', () => {
    expect(parseApprovalRules('')).toBeNull();
    expect(parseApprovalRules('be nice to everyone')).toBeNull();
    expect(parseApprovalRules('auto-approve bash')).toEqual({ bash: 'allow' });
    expect(parseApprovalRules('forbid shell')).toEqual({ bash: 'deny' });
    expect(parseApprovalRules('ask before reads')).toEqual({ read: 'prompt' });
    expect(parseApprovalRules('deny writes')).toEqual({ edit: 'deny', write: 'deny' });
    expect(parseApprovalRules('confirm for web search')).toEqual({ web_search: 'prompt' });
  });

  test('parseApprovalRules: the first matching line for a field wins', () => {
    expect(parseApprovalRules('allow bash\nask before bash')).toEqual({ bash: 'allow' });
  });

  test('writeToolsApproval writes nothing for empty fields', async () => {
    const agent = await freshAgentDir();
    await writeToolsApproval({});
    expect(await Bun.file(join(agent, 'config.yml')).exists()).toBe(false);
  });

  test('writeToolsApproval creates tools.approval on a file without a tools section', async () => {
    const agent = await freshAgentDir();
    const configPath = join(agent, 'config.yml');
    await Bun.write(configPath, 'theme: dark\n');
    await writeToolsApproval({ bash: 'allow' });
    expect(Bun.YAML.parse(await fs.promises.readFile(configPath, 'utf8'))).toEqual({
      theme: 'dark',
      tools: { approval: { bash: 'allow' } },
    });
  });

  test('writeToolsApproval keeps other keys under an existing tools section', async () => {
    const agent = await freshAgentDir();
    const configPath = join(agent, 'config.yml');
    await Bun.write(configPath, 'tools:\n  other: 1\n');
    await writeToolsApproval({ bash: 'allow', read: 'prompt' });
    expect(Bun.YAML.parse(await fs.promises.readFile(configPath, 'utf8'))).toEqual({
      tools: { other: 1, approval: { bash: 'allow', read: 'prompt' } },
    });
  });

  test('writeToolsApproval throws when tools is not a mapping', async () => {
    const agent = await freshAgentDir();
    await Bun.write(join(agent, 'config.yml'), 'tools: 5\n');
    await expect(writeToolsApproval({ bash: 'allow' })).rejects.toThrow('tools section must be a mapping');
  });
});
