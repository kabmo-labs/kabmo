/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The provider entry writer — the one path that can change an existing
 * `models.yml` provider.
 *
 * Every case here is a bug the panel shipped: a rotated key that never reached
 * omp, a masked placeholder persisted as a credential, an empty input written as
 * an empty string omp rejects, and a cleared dialect left on an entry that still
 * lists models.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { updateOmpProviderEntry } from '@/server/lib/omp/config/provider-entry';

let agentDir: string;
let previousAgentDir: string | undefined;

function modelsPath(): string {
  return join(agentDir, 'models.yml');
}

function read(): string {
  return readFileSync(modelsPath(), 'utf8');
}

function write(content: string): void {
  writeFileSync(modelsPath(), content);
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), 'kabmo-provider-entry-'));
  mkdirSync(join(agentDir, 'sessions'), { recursive: true });
  previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(agentDir, { recursive: true, force: true });
});

const ENTRY = `providers:
  gateway:
    baseUrl: https://old.example.com/v1
    apiKey: sk-old
    api: openai-completions
    models:
      - id: gpt-x
`;

describe('updateOmpProviderEntry', () => {
  test('replaces the endpoint and the key of an existing entry', async () => {
    // The whole point: `upsertOmpProviderModels` is add-only, so this write is
    // the only way a rotated credential reaches the file omp reads.
    write(ENTRY);

    const result = await updateOmpProviderEntry('gateway', {
      baseUrl: 'https://new.example.com/v1',
      apiKey: 'sk-new',
    });

    expect(result.written).toBe(true);
    expect(result.changed).toEqual(['baseUrl', 'apiKey']);
    const after = read();
    expect(after).toContain('https://new.example.com/v1');
    expect(after).toContain('sk-new');
    expect(after).not.toContain('sk-old');
    // The model list is not this writer's business.
    expect(after).toContain('id: gpt-x');
  });

  test('refuses a masked placeholder instead of overwriting a working key', async () => {
    write(ENTRY);

    const result = await updateOmpProviderEntry('gateway', { apiKey: 'sk-••••••••' });

    expect(result.written).toBe(false);
    expect(result.reason).toContain('masked placeholder');
    expect(read()).toContain('sk-old');
  });

  test('an empty string REMOVES the field rather than writing an empty one', async () => {
    // omp rejects `baseUrl: ""` outright, and a cleared input is how a user says
    // "no value". A keyless entry is the shape where removing the endpoint is
    // valid — a models-carrying one legitimately refuses (next test).
    write(`providers:
  local:
    baseUrl: http://localhost:1234/v1
    auth: none
    api: openai-completions
`);

    const result = await updateOmpProviderEntry('local', { baseUrl: '' });

    expect(result.written).toBe(true);
    expect(result.changed).toEqual(['baseUrl']);
    expect(read()).not.toContain('baseUrl');
  });

  test('a removal that would break the entry is refused, not written', async () => {
    // Removing the key from a models-carrying entry leaves omp with a provider
    // it rejects — and one rejected entry disables every custom provider.
    write(ENTRY);

    await expect(updateOmpProviderEntry('gateway', { apiKey: '' }))
      .rejects.toThrow(/apiKey.*required/);
    expect(read()).toContain('sk-old');
  });

  test('refuses when the provider has no entry — creating one is another path', async () => {
    write(ENTRY);

    const result = await updateOmpProviderEntry('missing', { baseUrl: 'https://x/v1' });

    expect(result.written).toBe(false);
    expect(result.reason).toContain('no models.yml entry');
    expect(read()).not.toContain('missing');
  });

  test('refuses to clear the dialect of an entry that still lists models', async () => {
    // A models-carrying entry without `api` makes omp reject the whole file.
    write(ENTRY);

    await expect(updateOmpProviderEntry('gateway', { api: null })).rejects.toThrow(/needs an "api"/);
    expect(read()).toContain('api: openai-completions');
  });

  test('keeps comments and unrelated keys', async () => {
    write(`# my gateways
providers:
  gateway:
    # rotated monthly
    baseUrl: https://old.example.com/v1
    apiKey: sk-old
    api: openai-completions
`);

    await updateOmpProviderEntry('gateway', { apiKey: 'sk-new' });

    const after = read();
    expect(after).toContain('# my gateways');
    expect(after).toContain('# rotated monthly');
    expect(after).toContain('sk-new');
  });

  test('writes a discovery block with only the knobs its type accepts', async () => {
    // `injectV1` outside openai-models-list is refused by omp, and one refused
    // field disables every custom provider in the file.
    write(`providers:
  local:
    baseUrl: http://localhost:1234/v1
    api: openai-completions
`);

    await updateOmpProviderEntry('local', {
      discovery: { type: 'lm-studio', injectV1: true, advertisedReasoning: true, timeoutMs: 5000 },
    });

    const after = read();
    expect(after).toContain('type: lm-studio');
    expect(after).toContain('advertisedReasoning: true');
    expect(after).toContain('timeoutMs: 5000');
    expect(after).not.toContain('injectV1');
  });

  test('writes and then clears pinned request headers', async () => {
    write(ENTRY);

    const written = await updateOmpProviderEntry('gateway', {
      headers: { 'X-Route': 'team-a', 'X-Version': '2' },
    });
    expect(written.changed).toEqual(['headers']);
    expect(read()).toContain('X-Route: team-a');

    const cleared = await updateOmpProviderEntry('gateway', { headers: null });
    expect(cleared.changed).toEqual(['headers']);
    expect(read()).not.toContain('X-Route');
  });

  test('reports "nothing to change" instead of claiming a write', async () => {
    write(ENTRY);

    const result = await updateOmpProviderEntry('gateway', {});

    expect(result.written).toBe(false);
    expect(result.reason).toBe('nothing to change');
  });

  test('drops `auth: apiKey` rather than pinning omp’s default', async () => {
    write(ENTRY);

    const result = await updateOmpProviderEntry('gateway', { auth: 'apiKey' });

    expect(result.written).toBe(false);
    expect(read()).not.toContain('auth:');
  });
});
