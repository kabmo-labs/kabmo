/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Importing a provider into another harness — the rule that makes it safe.
 *
 * The user asked for exactly one shape: "claude uses kenari, imported from omp".
 * Two facts decide whether that is an honest write or a silent breakage:
 *
 *  - **kenari is custom, `anthropic` is not.** A vendor id copied across would
 *    override the TARGET's own built-in provider, so the list filters it and the
 *    writer refuses it.
 *  - **kenari speaks Anthropic Messages even though omp calls it
 *    `openai-completions`.** Measured on the live host: `POST /v1/messages`
 *    answers, `/v1beta/models` is a 404 HTML page. Claude Code only speaks
 *    Anthropic Messages, so the import has to pick that protocol — and the probe
 *    is what measures it instead of trusting the source's declaration.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { customProviderIds, isVendorProviderId } from '@/shared/lib/models/provider/vendors';
import { importableProvidersFor, readRegistryProviders } from '@/server/lib/harness/provider-sources.server';
import { providerEnv } from '@/shared/lib/harness/providers';
import { EMPTY_HARNESS_CONFIG, parseEnvLines, withEnvValues } from '@/shared/lib/harness/config';
import { probeEndpointProtocols } from '@/server/lib/harness/provider-probe.server';
import { writeProvider } from '@/server/lib/harness/provider-write.server';

let root = '';
const savedHome = Bun.env.HOME;

/** A models.yml shaped like the developer's real one: custom rows only. */
const MODELS_YML = `providers:
  kenari:
    baseUrl: https://kenari.id/v1
    apiKey: kn-test
    api: openai-completions
    models:
      - id: claude-sonnet-5
        contextWindow: 1000000
      - id: deepseek-v4-1-flash
  anthropic:
    baseUrl: https://proxy.example/v1
    api: anthropic-messages
    models: []
`;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'kabmo-import-'));
  Bun.env.HOME = root;
  mkdirSync(join(root, '.omp/agent'), { recursive: true });
  await Bun.write(join(root, '.omp/agent/models.yml'), MODELS_YML);
});

afterAll(() => {
  Bun.env.HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

describe('the vendor census', () => {
  test('a provider the agent ships is not "custom"', () => {
    // This is the difference the user's rule turns on.
    expect(isVendorProviderId('anthropic')).toBe(true);
    expect(isVendorProviderId('openai')).toBe(true);
    expect(isVendorProviderId('github-copilot')).toBe(true);
    // A gateway a user registered yesterday is.
    expect(isVendorProviderId('kenari')).toBe(false);
    expect(isVendorProviderId('my-gateway')).toBe(false);
  });

  test('spelling differences fold before the comparison', () => {
    expect(isVendorProviderId('Google-Vertex')).toBe(true);
    expect(isVendorProviderId('llama.cpp')).toBe(true);
    expect(isVendorProviderId('LLAMA_CPP')).toBe(true);
  });

  test('a registry’s own reserved ids count as vendor ids for it', () => {
    // codex reserves these, so writing one would collide with its built-in.
    expect(isVendorProviderId('gcp', ['gcp'])).toBe(true);
    expect(customProviderIds(['kenari', 'anthropic', 'sumopod'])).toEqual(['kenari', 'sumopod']);
  });
});

describe('reading a source registry', () => {
  test('only CUSTOM entries come back, with the protocol each declares', async () => {
    const rows = await readRegistryProviders('omp-rpc');
    expect(rows.map((row) => row.id)).toEqual(['kenari']);
    const kenari = rows[0]!;
    expect(kenari.source).toBe('omp-rpc');
    expect(kenari.baseUrl).toBe('https://kenari.id/v1');
    expect(kenari.protocol).toBe('openai-chat');
    expect(kenari.hasKey).toBe(true);
    expect(kenari.models).toEqual(['claude-sonnet-5', 'deepseek-v4-1-flash']);
    // The context window travels so a target that REQUIRES one can write it.
    expect(kenari.contextWindow?.['claude-sonnet-5']).toBe(1_000_000);
  });

  test('the credential is not part of a row', async () => {
    const rows = await readRegistryProviders('omp-rpc');
    expect(JSON.stringify(rows)).not.toContain('kn-test');
  });

  test('an importable list for claude keeps the custom row', async () => {
    const rows = await importableProvidersFor('claude');
    expect(rows.some((row) => row.id === 'kenari')).toBe(true);
  });
});

describe('importing into an environment harness', () => {
  test('claude has no registry file, so the write refuses and names the surface', async () => {
    // The import for an environment harness is the ROUTE's env flattening, not a
    // file write; a draft that reaches the registry writer has to say so.
    await expect(writeProvider('claude', {
      id: 'kenari',
      name: 'Kenari',
      baseUrl: 'https://kenari.id/v1',
      protocol: 'anthropic-messages',
      models: ['claude-sonnet-5'],
      apiKey: 'kn-test',
    })).rejects.toThrow(/no provider registry/);
  });

  test('the flattened env is the vendor’s own variables, at the host root', () => {
    const env = providerEnv('claude', { baseUrl: 'https://kenari.id', apiKey: 'kn-test', model: 'claude-sonnet-5' });
    expect(env).toEqual({
      ANTHROPIC_BASE_URL: 'https://kenari.id',
      ANTHROPIC_AUTH_TOKEN: 'kn-test',
      ANTHROPIC_MODEL: 'claude-sonnet-5',
    });
  });

  test('an import REPLACES an existing variable instead of duplicating it', () => {
    const before = { ...EMPTY_HARNESS_CONFIG, env: 'ANTHROPIC_AUTH_TOKEN=old\nKEEP_ME=1' };
    const after = withEnvValues(before, { ANTHROPIC_AUTH_TOKEN: 'new' });
    expect(after.env).toBe('ANTHROPIC_AUTH_TOKEN=new\nKEEP_ME=1');
    // Parsed back by the SAME parser the spawn reads, so what the form shows is
    // what the agent gets.
    expect(parseEnvLines(after.env).env).toEqual({ ANTHROPIC_AUTH_TOKEN: 'new', KEEP_ME: '1' });
  });
});

describe('probeEndpointProtocols', () => {
  test('an empty endpoint is reported, not probed', async () => {
    const probe = await probeEndpointProtocols('');
    expect(probe.protocols).toEqual([]);
    expect(probe.error).toBeTruthy();
  });

  test('a host that answers nothing yields no protocols and no false positive', async () => {
    // Port 1 is closed on every sane host: this is the "cannot reach" path.
    const probe = await probeEndpointProtocols('http://127.0.0.1:1');
    expect(probe.protocols).toEqual([]);
    expect(probe.error).toBeTruthy();
  });

  test('a host that answers Anthropic and OpenAI Chat is measured as exactly that', async () => {
    // The stub mirrors the measured shape of kenari.id: `/v1/messages` and
    // `/v1/chat/completions` exist, `/v1/responses` and the Gemini listing do not.
    const server = Bun.serve({
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === '/v1/messages') {
          return Response.json({ error: { message: 'invalid Anthropic request JSON: missing field `model`' } }, { status: 400 });
        }
        if (path === '/v1/chat/completions') {
          return Response.json({ error: { message: 'invalid JSON: missing field `model`' } }, { status: 400 });
        }
        // The site's own 404 page, as HTML — a route that is NOT there.
        return new Response('<!DOCTYPE html><html></html>', {
          status: 400,
          headers: { 'content-type': 'text/html' },
        });
      },
    });
    try {
      const probe = await probeEndpointProtocols(`http://127.0.0.1:${server.port}/v1`);
      expect(probe.protocols).toEqual(['openai-chat', 'anthropic-messages']);
      // The probe asks the HOST, never with a credential.
      expect(probe.root).toBe(`http://127.0.0.1:${server.port}`);
    } finally {
      server.stop(true);
    }
  });
});
