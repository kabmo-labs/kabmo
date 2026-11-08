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

  test('zcode credentials belong to the ZCode app, never to Kabmo', () => {
    // The ACP bridge reads the app's own config.json / acp-accounts.json. An
    // editor that rewrote either would break the install it is driving.
    const registry = providerFacts('zcode').registry;
    expect(registry.kind).toBe('agent-managed');
    expect(registry.file).toBe('.zcode/v2/config.json');
    expect(registry.writable).toBe(false);
    expect(managesProviders('zcode')).toBe(false);
  });

  test('the env-only harnesses keep their vendor variable names', () => {
    expect(providerFacts('claude').env).toEqual({
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
  });
});

describe('providerEnv', () => {
  test('a provider becomes the vendor’s own variables', () => {
    expect(providerEnv('claude', { baseUrl: 'https://gw', apiKey: 'sk-1', model: 'claude-sonnet-5' }))
      .toEqual({ ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_AUTH_TOKEN: 'sk-1', ANTHROPIC_MODEL: 'claude-sonnet-5' });
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
