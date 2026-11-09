/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * WHERE each harness keeps its providers — the facts the settings page writes by.
 *
 * The first version of this table GUESSED, and was wrong three times over. These
 * cases exist so the corrections cannot be undone:
 *
 *  - **`opencode2` was never a second registry** — it read the same
 *    `opencode.json` as 1.x, verified by writing a provider and watching both
 *    binaries list it. The entry is now RETIRED outright: the preview became a shim
 *    for `opencode`, so there is one binary and one tab.
 *  - **codex HAS a registry.** Its own reference documents
 *    `[model_providers.<id>]` with `base_url`, `env_key` and `wire_api`; calling it
 *    "no registry" sent the reader to the wrong page.
 *  - **pi, kimi and qwen have one each**, in three different formats — which is
 *    the work, not a detail to smooth over.
 *
 * The credential rule is the other half: two formats (`codex`, `qwen`) store the
 * NAME of an environment variable, never the secret. A form that wrote a key there
 * would put a credential in a file the vendor's docs keep it out of.
 */

import { describe, expect, test } from 'bun:test';
import {
  aliasModelFor,
  credentialFieldLabel,
  credentialIsEnvName,
  dialectChoices,
  providerEnv,
  providerLevel,
  registryLabel,
  supportsProviderEditor,
} from '@/shared/lib/harness/providers';
import { HARNESS_PROVIDER_FACTS, managesProviders, providerFacts } from '@/shared/lib/harness/provider-facts';
import { HARNESS_IDS } from '@/shared/lib/harness/catalog';

/** Harnesses whose registry Kabmo may WRITE, with the format it writes. */
const WRITABLE: Record<string, string> = {
  'omp-rpc': 'yaml-providers',
  'omp-acp': 'yaml-providers',
  opencode: 'json-provider',
  codex: 'toml-model-providers',
  pi: 'json-providers',
  kimi: 'toml-providers',
  qwen: 'json-model-providers',
  zcode: 'zcode-provider-rules',
};

describe('the measured registry table', () => {
  test('every harness this build lists has facts', () => {
    for (const id of HARNESS_IDS) {
      expect(HARNESS_PROVIDER_FACTS[id], `no provider facts for ${id}`).toBeDefined();
    }
  });

  test('a retired harness has no facts at all', () => {
    // `opencode2` was a second catalog entry while the 2.x preview was its own
    // binary. It is now a shim that execs `opencode`, so the entry is gone — and a
    // lookup must say "unknown" rather than borrow the neighbour's registry.
    expect(providerFacts('opencode2').registry.kind).toBe('none');
    expect(providerFacts('opencode').registry.kind).toBe('json-provider');
  });

  test('omp and its ACP transport name the same models.yml', () => {
    expect(providerFacts('omp-acp').registry.file).toBe(providerFacts('omp-rpc').registry.file);
    expect(providerFacts('omp-rpc').registry.kind).toBe('yaml-providers');
  });

  test('the writable harnesses are exactly the ones with a format writer', () => {
    for (const [id, kind] of Object.entries(WRITABLE)) {
      expect(providerFacts(id).registry.kind).toBe(kind as never);
      expect(providerFacts(id).registry.writable).toBe(true);
      expect(managesProviders(id)).toBe(true);
      expect(supportsProviderEditor(id)).toBe(true);
    }
  });

  test('minimax has a registry that belongs to the AGENT', () => {
    // A registry exists — `mcode` writes it — so "nothing to edit" would be
    // false, and writing it from outside is how a working install stops signing in.
    const registry = providerFacts('minimax').registry;
    expect(registry.kind).toBe('agent-managed');
    expect(registry.writable).toBe(false);
    expect(managesProviders('minimax')).toBe(false);
  });

  test('zcode writes personal providers beside the app, never the app config', () => {
    // 3.12+ stores user-added providers in `provider_config.json`; the legacy
    // `config.json` map is the desktop app's and keeps its credentials. Writing
    // THAT file is how a signed-in install stops signing in.
    const registry = providerFacts('zcode').registry;
    expect(registry.kind).toBe('zcode-provider-rules');
    expect(registry.file).toBe('.zcode/v2/provider_config.json');
    expect(registry.file).not.toBe('.zcode/v2/config.json');
    expect(registry.pointer).toBe('config.providerConfigRules.providerRules');
    expect(registry.baseUrlField).toBe('config.api.baseUrl');
    expect(registry.apiKeyField).toBe('config.access.apiKey');
    expect(registry.dialectField).toBe('config.api.type');
    expect(registry.writable).toBe(true);
    expect(managesProviders('zcode')).toBe(true);
  });

  test('the env-only harnesses keep their vendor variable names', () => {
    // The alias table is asserted in `providerEnv` below; this is the endpoint
    // and key each vendor documents.
    expect(providerFacts('claude').env).toMatchObject({
      baseUrl: 'ANTHROPIC_BASE_URL', apiKey: 'ANTHROPIC_AUTH_TOKEN', model: 'ANTHROPIC_MODEL',
    });
    expect(providerFacts('antigravity').env).toEqual({
      baseUrl: 'GOOGLE_GEMINI_BASE_URL', apiKey: 'GEMINI_API_KEY',
    });
    // Both REPLACE the vendor rather than adding beside it.
    expect(providerFacts('claude').createsChoice).toBe(false);
    expect(providerFacts('antigravity').createsChoice).toBe(false);
    expect(providerLevel('claude')).toBe('environment');
  });

  test('every writable registry states the field names a writer must use', () => {
    for (const id of Object.keys(WRITABLE)) {
      const registry = providerFacts(id).registry;
      expect(registry.pointer, `${id} has no pointer`).toBeTruthy();
      expect(registry.baseUrlField, `${id} has no base-URL field`).toBeTruthy();
      expect(registry.apiKeyField, `${id} has no credential field`).toBeTruthy();
    }
  });

  test('an unknown harness degrades to "nothing to offer"', () => {
    expect(providerLevel('some-future-agent')).toBe('none');
    expect(supportsProviderEditor('some-future-agent')).toBe(false);
    expect(managesProviders(null)).toBe(false);
  });
});

describe('credential fields that hold a NAME', () => {
  test('codex and qwen are told apart from the ones that hold the secret', () => {
    expect(credentialIsEnvName('codex')).toBe(true);
    expect(credentialIsEnvName('qwen')).toBe(true);
    expect(credentialFieldLabel('codex')).toContain('variable NAME');
    // The others store the value itself.
    expect(credentialIsEnvName('opencode')).toBe(false);
    expect(credentialIsEnvName('omp-rpc')).toBe(false);
  });
});

describe('labels a reader can check against the vendor docs', () => {
  test('each format is named the way its file is named', () => {
    expect(registryLabel('omp-rpc')).toBe('models.yml (omp)');
    expect(registryLabel('opencode')).toBe('opencode.json');
    expect(registryLabel('codex')).toBe('config.toml (codex)');
    expect(registryLabel('pi')).toBe('models.json (pi)');
    expect(registryLabel('kimi')).toBe('config.toml (kimi)');
    expect(registryLabel('qwen')).toBe('settings.json (qwen)');
    expect(registryLabel('claude')).toBe('environment variables');
  });

  test('the dialect vocabulary is the one that format documents', () => {
    // A writer must not invent a value the agent rejects.
    expect(dialectChoices('json-provider').map((d) => d.value)).toContain('@ai-sdk/anthropic');
    expect(dialectChoices('toml-model-providers').map((d) => d.value)).toEqual(['chat', 'responses']);
    expect(dialectChoices('toml-providers').map((d) => d.value)).toContain('openai_legacy');
    // qwen routes by protocol id, so it has no dialect field of its own.
    expect(dialectChoices('json-model-providers')).toEqual([]);
    // ZCode documents exactly these three wire types; Gemini has no route there.
    expect(dialectChoices('zcode-provider-rules').map((d) => d.value)).toEqual([
      'anthropic-messages', 'openai-chat-completions', 'openai-responses',
    ]);
  });
});

describe('providerEnv', () => {
  test('a provider becomes the vendor’s own variables', () => {
    expect(providerEnv('claude', { baseUrl: 'https://gw', apiKey: 'sk-1', model: 'claude-sonnet-5' }))
      .toEqual({ ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_AUTH_TOKEN: 'sk-1', ANTHROPIC_MODEL: 'claude-sonnet-5' });
  });

  test('claude pins every picker alias, so a gateway id can replace the vendor’s', () => {
    // Measured: `--model sonnet` against a gateway listing `claude-sonnet-5-5`
    // answered `400 model not found: sonnet` until the alias variable existed.
    expect(providerFacts('claude').env?.modelAliases).toEqual([
      { family: 'opus', env: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
      { family: 'sonnet', env: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
      { family: 'haiku', env: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
      { family: 'fable', env: 'ANTHROPIC_DEFAULT_FABLE_MODEL' },
    ]);
  });

  test('a versioned provider id is reduced to the id the endpoint expects', () => {
    // The gateway's own list may spell the model provider-qualified; the env
    // variable names the model, not the route.
    expect(aliasModelFor('sonnet', ['kenari/claude-sonnet-5'])).toBe('claude-sonnet-5');
  });

  test('an endpoint with no model of the family pins nothing', () => {
    expect(aliasModelFor('opus', ['qwen3-8-27b:free', 'glm-5-3-flash'])).toBeNull();
    expect(providerEnv('claude', { baseUrl: 'https://gw', apiKey: 'sk-1', models: ['qwen3-8-27b:free'] }))
      .not.toHaveProperty('ANTHROPIC_DEFAULT_OPUS_MODEL');
  });

  test('every alias the endpoint serves is pinned, and none it does not', () => {
    // Measured on kenari: `sonnet` and `opus` are answered 400 as literal ids
    // while their family ids complete. The list is the authority.
    const env = providerEnv('claude', {
      baseUrl: 'https://gw',
      apiKey: 'sk-1',
      models: ['claude-sonnet-5', 'claude-opus-5', 'deepseek-v4-pro'],
    });
    expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('claude-sonnet-5');
    expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('claude-opus-5');
    expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_HAIKU_MODEL');
    expect(env).not.toHaveProperty('ANTHROPIC_DEFAULT_FABLE_MODEL');
  });

  test('a blank field writes no variable at all', () => {
    // An empty env var is a real thing to set, so the form must not do it by
    // accident.
    expect(providerEnv('claude', { baseUrl: '  ', apiKey: 'sk-1' })).toEqual({ ANTHROPIC_AUTH_TOKEN: 'sk-1' });
  });

  test('a registry harness has no env contract', () => {
    expect(providerEnv('opencode', { baseUrl: 'x', apiKey: 'y' })).toEqual({});
  });
});
