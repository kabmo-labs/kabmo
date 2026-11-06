/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Writing a provider into a harness's OWN registry, in that harness's format.
 *
 * Six formats, and every case here is about what the writer must NOT destroy —
 * because these files are the AGENT's whole config, not a provider list:
 * `opencode.json` carries plugins, agents, MCP and permissions; `config.toml`
 * carries the model, approval policy and hooks; `settings.json` (qwen) carries
 * the user's whole CLI configuration.
 *
 * Three rules are pinned across formats:
 *
 *  - an unparseable file is REFUSED and left byte-identical;
 *  - a stored credential and the user's own dialect are KEPT when an entry is
 *    updated — an import brings an endpoint, not a reason to replace a key;
 *  - codex and qwen store a VARIABLE NAME (`env_key`/`envKey`), never the secret,
 *    which is what their own docs say and what a form must not get wrong.
 *
 * Every case writes to a TEMP `~`, by pointing HOME at one: a suite that touched
 * the developer's real `~/.codex` or `~/.config/opencode` would corrupt a working
 * install.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { providerEntryFor, ProviderWriteError, writeProvider } from '@/server/lib/harness/provider-write.server';
import { registryFilePath } from '@/server/lib/harness/provider-sources.server';
import { removeDir } from '@/test-support/remove-dir';

const savedHome = Bun.env.HOME;
let root = '';

beforeAll(async () => {
  root = await fs.promises.mkdtemp(join(tmpdir(), 'omc-provider-'));
  // Every path in this module is home-relative, and the writer REFUSES to leave
  // `KABMO_TEST_HOME` under test — that guard exists because an earlier run of
  // this feature wrote into the developer's real `~/.codex` and `~/.omp` while
  // the scripted checks were passing.
  Bun.env.HOME = root;
  Bun.env.KABMO_TEST_HOME = root;
});

afterAll(() => {
  if (savedHome === undefined) delete Bun.env.HOME;
  else Bun.env.HOME = savedHome;
  delete Bun.env.KABMO_TEST_HOME;
  removeDir(root);
});

beforeEach(async () => {
  for (const dir of ['.config/opencode', '.codex', '.kimi', '.qwen', '.pi/agent', '.omp/agent']) {
    await fs.promises.rm(join(root, dir), { recursive: true, force: true });
  }
});

const DRAFT = {
  id: 'gateway',
  name: 'My gateway',
  baseUrl: 'https://api.example.com/v1',
  dialect: 'openai-completions',
  models: ['m-1', 'm-2'],
  apiKey: 'sk-test',
};

/** Write a seed file into the temp HOME, creating its directory. */
async function seed(relative: string, content: string): Promise<void> {
  const path = join(root, relative);
  await fs.promises.mkdir(join(path, '..'), { recursive: true });
  await Bun.write(path, content);
}

async function read(relative: string): Promise<string> {
  return Bun.file(join(root, relative)).text();
}

describe('opencode (JSON provider map)', () => {
  test('adds a provider and keeps every other section', async () => {
    await seed('.config/opencode/opencode.json', JSON.stringify({
      $schema: 'https://opencode.ai/config.json',
      plugin: ['a@1'],
      agent: { build: { model: 'x/y' } },
      provider: { existing: { npm: '@ai-sdk/openai', models: {} } },
    }, null, 2));

    await writeProvider('opencode', DRAFT);
    const doc = JSON.parse(await read('.config/opencode/opencode.json'));
    expect(doc.plugin).toEqual(['a@1']);
    expect(doc.agent).toEqual({ build: { model: 'x/y' } });
    expect(doc.provider.existing).toBeDefined();
    expect(doc.provider.gateway.npm).toBe('@ai-sdk/openai-compatible');
    expect(doc.provider.gateway.options.baseURL).toBe('https://api.example.com/v1');
    expect(Object.keys(doc.provider.gateway.models)).toEqual(['m-1', 'm-2']);
  });

  test('one opencode registry, now that the 2.x preview IS the 1.x binary', async () => {
    // `opencode2` used to be a separate binary with its own beta line; it is now a
    // shim that execs `opencode` (measured: both report v2.2.5). There is no second
    // registry to keep in step, so the catalog has one opencode entry.
    expect(registryFilePath('opencode')).toBeTruthy();
    await writeProvider('opencode', DRAFT);
    const doc = JSON.parse(await read('.config/opencode/opencode.json'));
    expect(doc.provider.gateway).toBeDefined();
  });

  test('an update keeps a stored key and the user’s own dialect', async () => {
    await seed('.config/opencode/opencode.json', JSON.stringify({
      provider: { gateway: { npm: '@ai-sdk/anthropic', name: 'Hand named', options: { apiKey: 'old-key', whitelist: 'x' }, models: {} } },
    }, null, 2));

    const result = await writeProvider('opencode', DRAFT);
    expect(result.replaced).toBe(true);

    const entry = JSON.parse(await read('.config/opencode/opencode.json')).provider.gateway;
    expect(entry.npm).toBe('@ai-sdk/anthropic');
    expect(entry.name).toBe('Hand named');
    expect(entry.options.apiKey).toBe('old-key');
    expect(entry.options.whitelist).toBe('x');
    expect(entry.options.baseURL).toBe('https://api.example.com/v1');
  });

  test('a file that is not JSON is refused and left untouched', async () => {
    await seed('.config/opencode/opencode.json', '{ not json');
    await expect(writeProvider('opencode', DRAFT)).rejects.toThrow(ProviderWriteError);
    expect(await read('.config/opencode/opencode.json')).toBe('{ not json');
  });
});

describe('omp (YAML providers map)', () => {
  test('adds a provider with the fields omp reads', async () => {
    await seed('.omp/agent/models.yml', 'providers:\n  existing:\n    baseUrl: https://x/v1\n    api: openai-completions\n');
    await writeProvider('omp-rpc', DRAFT);

    const text = await read('.omp/agent/models.yml');
    // YAML, and the key names omp's own schema uses.
    expect(text).toContain('gateway:');
    expect(text).toContain('baseUrl: https://api.example.com/v1');
    expect(text).toContain('api: openai-completions');
    expect(text).toContain('- id: m-1');
    // The pre-existing provider survives the merge.
    expect(text).toContain('existing:');
  });
});

describe('codex (TOML model_providers)', () => {
  test('stores a VARIABLE NAME, never the secret', async () => {
    // codex reads `env_key`, which names an env var. Writing `sk-test` into
    // config.toml would put the credential in a file its docs keep it out of.
    await writeProvider('codex', DRAFT);
    const text = await read('.codex/config.toml');
    expect(text).toContain('[model_providers.gateway]');
    expect(text).toContain('base_url = "https://api.example.com/v1"');
    expect(text).toContain('env_key = "OPENAI_API_KEY"');
    expect(text).not.toContain('sk-test');
    expect(text).toContain('wire_api = "chat"');
  });

  test('a dialect codex cannot speak is REFUSED, not mislabelled', async () => {
    // An Anthropic endpoint written as `wire_api = "chat"` would fail on the
    // first request against a gateway that never agreed to that protocol.
    await expect(writeProvider('codex', { ...DRAFT, dialect: 'anthropic-messages' }))
      .rejects.toThrow(/cannot speak "anthropic-messages"/);
    expect(await fs.promises.stat(join(root, '.codex/config.toml')).catch(() => null)).toBeNull();
  });

  test('a Responses source becomes wire_api = "responses"', async () => {
    const entry = providerEntryFor('toml-model-providers', { ...DRAFT, dialect: 'openai-responses' });
    expect(entry.wire_api).toBe('responses');
  });

  test('the rest of config.toml survives', async () => {
    await seed('.codex/config.toml', 'model = "gpt-6"\napproval_policy = "on-request"\n');
    await writeProvider('codex', DRAFT);
    const text = await read('.codex/config.toml');
    expect(text).toContain('model = "gpt-6"');
    expect(text).toContain('approval_policy = "on-request"');
    expect(text).toContain('[model_providers.gateway]');
  });
});

describe('pi (JSON providers map)', () => {
  test('adds a provider with baseUrl, api and models', async () => {
    await writeProvider('pi', DRAFT);
    const doc = JSON.parse(await read('.pi/agent/models.json'));
    expect(doc.providers.gateway.baseUrl).toBe('https://api.example.com/v1');
    expect(doc.providers.gateway.api).toBe('openai-completions');
    expect(doc.providers.gateway.models).toEqual([{ id: 'm-1' }, { id: 'm-2' }]);
  });
});

describe('kimi (TOML providers table)', () => {
  test('maps the dialect onto kimi’s `type`', async () => {
    await writeProvider('kimi', { ...DRAFT, dialect: 'anthropic-messages' });
    const text = await read('.kimi/config.toml');
    expect(text).toContain('[providers.gateway]');
    expect(text).toContain('type = "anthropic"');
    expect(text).toContain('base_url = "https://api.example.com/v1"');
    expect(text).toContain('api_key = "sk-test"');
  });
});

describe('qwen (JSON modelProviders, array per protocol)', () => {
  test('a route is a MODEL row under a protocol bucket, with envKey', async () => {
    await writeProvider('qwen', DRAFT);
    const doc = JSON.parse(await read('.qwen/settings.json'));
    const openai = doc.modelProviders.openai as { id: string; baseUrl: string; envKey: string }[];
    expect(openai).toHaveLength(1);
    expect(openai[0].id).toBe('m-1');
    expect(openai[0].baseUrl).toBe('https://api.example.com/v1');
    expect(openai[0].envKey).toBe('OPENAI_API_KEY');
    // The secret stays out of settings.json, as its docs require.
    expect(JSON.stringify(doc)).not.toContain('sk-test');
  });
});

describe('refusals', () => {
  test('a harness with no writable registry is refused, naming it', async () => {
    await expect(writeProvider('minimax', DRAFT)).rejects.toThrow(/keeps its providers itself/);
    await expect(writeProvider('cursor', DRAFT)).rejects.toThrow(/no provider registry/);
  });

  test('an id the agent would reject is refused before anything is written', async () => {
    await expect(writeProvider('opencode', { ...DRAFT, id: 'Not Valid!' })).rejects.toThrow(/not a provider id/);
    expect(await fs.promises.stat(join(root, '.config/opencode/opencode.json')).catch(() => null)).toBeNull();
  });

  test('a write outside the test home is REFUSED', async () => {
    // The guard that exists because an earlier run wrote into a real `~/.codex`.
    const saved = Bun.env.KABMO_TEST_HOME;
    Bun.env.KABMO_TEST_HOME = join(root, 'elsewhere');
    try {
      await expect(writeProvider('opencode', DRAFT)).rejects.toThrow(/refusing to write/);
    } finally {
      Bun.env.KABMO_TEST_HOME = saved;
    }
  });

  test('the file is written 0600: it holds a credential', async () => {
    await writeProvider('opencode', DRAFT);
    const mode = (await fs.promises.stat(join(root, '.config/opencode/opencode.json'))).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
