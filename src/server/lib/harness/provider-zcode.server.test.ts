/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * ZCode's personal provider file is a RULE GRAPH, and these cases pin the two
 * things a map-shaped writer would get wrong:
 *
 *  - a provider rule alone is invisible (the bridge builds its dropdown from
 *    `modelConfigRules`), so a write must emit one model rule per id;
 *  - the file also holds the desktop's manual capability blocks, headers and
 *    default selection — a merge that rewrites them breaks an install.
 *
 * Measured against the bridge's own 0.82.3 reader (`loadPersonalModels` /
 * `appendPersonalOnlyProviders`): with this file present, `session/new`
 * advertises `kenari\qwen3-8-27b:free` even when `config.json` does not exist.
 */

import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readZcodeProviderKey, readZcodeProviders, writeZcodeProvider } from '@/server/lib/harness/provider-zcode.server';
import { ProviderWriteError } from '@/server/lib/harness/provider-write-error';

function tempFile(content?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-zcode-'));
  const file = path.join(dir, 'provider_config.json');
  if (content !== undefined) fs.writeFileSync(file, content, { mode: 0o600 });
  return file;
}

const EXISTING = JSON.stringify({
  schemaVersion: 1,
  config: {
    providerConfigRules: {
      providerRules: [
        {
          providerId: 'existing',
          providerName: 'Existing Gateway',
          enabled: true,
          config: {
            group: 'standard-personal',
            access: { type: 'api-key', apiKey: 'sk-keep' },
            api: { type: 'anthropic-messages', baseUrl: 'https://old.example', headers: { 'X-Keep': '1' } },
            personalModelIds: ['old-model'],
            modelOrder: ['old-model'],
            visibility: 'visible',
          },
        },
      ],
    },
    modelConfigRules: {
      providerModelRules: [],
      manualProviderModelRules: [
        {
          providerId: 'existing',
          modelId: 'old-model',
          config: {
            enabled: true,
            properties: { contextWindow: 64000, supportsJsonSchemaOutput: false },
            optionSpecs: { reasoningLevel: { values: ['low'], map: '{}' } },
          },
        },
      ],
    },
    defaultModelSelection: { providerId: 'existing', modelId: 'old-model' },
  },
}, null, 2);

describe('reading the personal provider rules', () => {
  test('a provider is listed with its model rules, personal ids and no key', () => {
    const rows = readZcodeProviders(EXISTING, 'zcode');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'existing',
      name: 'Existing Gateway',
      baseUrl: 'https://old.example',
      dialect: 'anthropic-messages',
      protocol: 'anthropic-messages',
      models: ['old-model'],
      contextWindow: { 'old-model': 64000 },
      hasKey: true,
      source: 'zcode',
    });
    // The credential itself never leaves the file.
    expect('apiKey' in rows[0]!).toBe(false);
  });

  test('custom providers added only through personalModelIds stay visible', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [{
            providerId: 'gateway',
            providerName: 'Gateway',
            config: { api: { type: 'openai-chat-completions', baseUrl: 'https://gw.example/v1' }, personalModelIds: ['m-1'] },
          }],
        },
        modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      },
    });
    expect(readZcodeProviders(text, 'zcode')[0]?.models).toEqual(['m-1']);
  });

  test('builtin and account ids are runtime-owned, but `local` is a custom id', () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [
            { providerId: 'builtin:zai-coding-plan', config: {} },
            { providerId: 'account:bigmodel-individual-coding-plan', config: {} },
            { providerId: 'local', providerName: 'Local llama.cpp', config: {} },
          ],
        },
        modelConfigRules: { providerModelRules: [], manualProviderModelRules: [] },
      },
    });
    // ZCode's own reference uses `local` as its custom-provider example; the
    // shared vendor census names `local` too and must not hide it here.
    expect(readZcodeProviders(text, 'zcode').map((row) => row.id)).toEqual(['local']);
  });

  test('a malformed file yields no rows and no key', () => {
    expect(readZcodeProviders('{not json', 'zcode')).toEqual([]);
    expect(readZcodeProviderKey('{not json', 'existing')).toBeNull();
  });

  test('a stored key is read only by id', () => {
    expect(readZcodeProviderKey(EXISTING, 'existing')).toBe('sk-keep');
    expect(readZcodeProviderKey(EXISTING, 'missing')).toBeNull();
  });
});

describe('writing a provider into the rule graph', () => {
  test('a new provider gets a rule and one model rule per id', async () => {
    const file = tempFile(EXISTING);
    const result = await writeZcodeProvider({
      path: file,
      id: 'kenari',
      draft: {
        id: 'kenari',
        name: 'Kenari',
        baseUrl: 'https://kenari.id/v1',
        protocol: 'openai-chat',
        models: ['qwen3-8-27b:free'],
        apiKey: 'kn-1',
        contextWindow: { 'qwen3-8-27b:free': 262144 },
      },
      dialect: 'openai-chat-completions',
    });
    expect(result.replaced).toBe(false);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    const text = fs.readFileSync(file, 'utf8');
    expect(text.endsWith('}')).toBe(true);
    const doc = JSON.parse(text);
    const rules = doc.config.providerConfigRules.providerRules;
    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({
      providerId: 'kenari',
      providerName: 'Kenari',
      enabled: true,
      config: {
        access: { type: 'api-key', apiKey: 'kn-1' },
        api: { type: 'openai-chat-completions', baseUrl: 'https://kenari.id/v1' },
        personalModelIds: ['qwen3-8-27b:free'],
      },
    });
    expect(doc.config.modelConfigRules.providerModelRules).toEqual([{
      providerId: 'kenari',
      modelId: 'qwen3-8-27b:free',
      config: {
        enabled: true,
        properties: { contextWindow: 262144 },
        optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' } },
      },
    }]);
    // The desktop's own state is not ours to rewrite.
    expect(doc.config.modelConfigRules.manualProviderModelRules).toHaveLength(1);
    expect(doc.config.defaultModelSelection).toEqual({ providerId: 'existing', modelId: 'old-model' });
  });

  test('an update keeps the stored key, headers and a manual model rule', async () => {
    const file = tempFile(EXISTING);
    await writeZcodeProvider({
      path: file,
      id: 'existing',
      draft: {
        id: 'existing',
        name: 'Existing Gateway',
        baseUrl: 'https://new.example',
        protocol: 'anthropic-messages',
        models: ['new-model'],
      },
      dialect: 'anthropic-messages',
    });
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const rule = doc.config.providerConfigRules.providerRules[0];
    expect(rule.config.access.apiKey).toBe('sk-keep');
    expect(rule.config.api).toMatchObject({
      type: 'anthropic-messages',
      baseUrl: 'https://new.example',
      headers: { 'X-Keep': '1' },
    });
    // Union, not replacement: a model the user already had is not dropped.
    expect(rule.config.personalModelIds).toEqual(['old-model', 'new-model']);
    // The manual rule stays manual (moving it would drop the capability block),
    // and the new model gets a smart rule.
    expect(doc.config.modelConfigRules.manualProviderModelRules).toHaveLength(1);
    expect(doc.config.modelConfigRules.providerModelRules).toEqual([{
      providerId: 'existing',
      modelId: 'new-model',
      config: {
        enabled: true,
        optionSpecs: { reasoningLevel: { values: ['disabled', 'enabled'], map: '{}' } },
      },
    }]);
  });

  test('a model rule is never duplicated across the two arrays', async () => {
    const file = tempFile(EXISTING);
    await writeZcodeProvider({
      path: file,
      id: 'existing',
      draft: {
        id: 'existing',
        name: 'Existing Gateway',
        baseUrl: 'https://old.example',
        protocol: 'anthropic-messages',
        models: ['old-model'],
      },
      dialect: 'anthropic-messages',
    });
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(doc.config.modelConfigRules.providerModelRules).toEqual([]);
    expect(doc.config.modelConfigRules.manualProviderModelRules[0].modelId).toBe('old-model');
  });

  test('a malformed file is refused untouched', async () => {
    const file = tempFile('{broken');
    await expect(writeZcodeProvider({
      path: file,
      id: 'kenari',
      draft: { id: 'kenari', name: 'Kenari', baseUrl: 'https://kenari.id/v1', protocol: 'openai-chat', models: ['m'] },
      dialect: 'openai-chat-completions',
    })).rejects.toThrow(ProviderWriteError);
    expect(fs.readFileSync(file, 'utf8')).toBe('{broken');
  });

  test('a provider with no endpoint is refused instead of written broken', async () => {
    const file = tempFile();
    await expect(writeZcodeProvider({
      path: file,
      id: 'kenari',
      draft: { id: 'kenari', name: 'Kenari', protocol: 'openai-chat', models: ['m'] },
      dialect: 'openai-chat-completions',
    })).rejects.toThrow(/base URL/);
    expect(fs.existsSync(file)).toBe(false);
  });
});
