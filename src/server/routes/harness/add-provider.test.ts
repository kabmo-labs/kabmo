/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * "Add provider" on a harness card — the typed twin of an import.
 *
 * Three rules make it honest, and each replaced a way the feature could lie:
 *
 *  - **The id under the field is the key that lands.** The form previews with the
 *    same function the route validates with (`providerSlugFrom`), so a name is
 *    never silently rewritten into a timestamped id.
 *  - **The protocol is measured, not chosen.** A dropdown would offer an opinion;
 *    the probe has evidence, and the measured case proves it matters — `kenari`
 *    declares Chat Completions and works in Claude Code through Anthropic
 *    Messages.
 *  - **A successful add is VISIBLE.** The card lists the agent's own registry
 *    rows, so "added" and "wrote nothing" cannot render the same.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { restoreEnv } from '@/test-support/env';
import { action, loader } from '@/server/routes/harness/root';
import { providerIdProblem, providerSlugFrom } from '@/shared/lib/harness/provider-slug';
import { isVendorProviderId } from '@/shared/lib/models/provider/vendors';

const ROOT = path.join(os.tmpdir(), 'kabmo-harness-add');
const API = 'http://localhost/api/harness';

type Handler = (args: never) => unknown;

function call(handler: Handler, request: Request): Promise<Response> {
  return handler({ request, params: {} } as never) as Promise<Response>;
}

function post(body: unknown): Request {
  return new Request(API, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });
}

const savedHome = Bun.env.HOME;
let stub: { port?: number; stop(force?: boolean): void } | null = null;
let baseUrl = '';

beforeAll(() => {
  fs.mkdirSync(path.join(ROOT, '.omp/agent'), { recursive: true });
  Bun.env.HOME = ROOT;
  Bun.env.KABMO_TEST_HOME = ROOT;
  fs.writeFileSync(path.join(ROOT, '.omp/agent/models.yml'), 'providers: {}\n');
});

beforeEach(async () => {
  await isolateDb();
  // A host shaped like the measured one: Anthropic Messages and OpenAI Chat
  // answer a malformed body; the Responses route and the Gemini listing do not.
  stub = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === '/v1/messages') {
        return Response.json({ error: { message: 'invalid Anthropic request JSON: missing field `model`' } }, { status: 400 });
      }
      if (pathname === '/v1/chat/completions') {
        return Response.json({ error: { message: 'invalid JSON: missing field `model`' } }, { status: 400 });
      }
      return new Response('<!DOCTYPE html><html></html>', { status: 404, headers: { 'content-type': 'text/html' } });
    },
  });
  baseUrl = `http://127.0.0.1:${stub.port ?? 0}/v1`;
});

afterEach(async () => {
  stub?.stop(true);
  stub = null;
  await releaseDb();
});

afterAll(() => {
  restoreEnv('HOME', savedHome);
  delete Bun.env.KABMO_TEST_HOME;
  fs.rmSync(ROOT, { recursive: true, force: true });
});

describe('the id rule the form and the route share', () => {
  test('a display name becomes the key that lands', () => {
    expect(providerSlugFrom('My Gateway (EU)')).toBe('my-gateway-eu');
    expect(providerSlugFrom('  Kenari.id ')).toBe('kenari-id');
    expect(providerSlugFrom('Tooker')).toBe('tooker');
    expect(providerSlugFrom('!!!')).toBe('');
  });

  test('an id no registry accepts is refused with the shape it needs', () => {
    expect(providerIdProblem('')).toContain('name');
    expect(providerIdProblem('-leading-dash')).toContain('letter or digit');
    expect(providerIdProblem('ok-with:colon')).toBeNull();
    expect(providerIdProblem('ok.with.dot')).toBeNull();
  });
});

describe('adding a provider to a registry harness', () => {
  test('the probe picks the protocol the host answers, and the entry is written', async () => {
    const response = await call(action, post({
      probe: 'omp-acp',
      addProvider: { name: 'Stub Gateway', baseUrl, apiKey: 'sk-add-test' },
    }));
    const payload = await response.json() as { error?: string; protocol?: string; imported?: { id: string; dialect: string } };
    expect(payload.error).toBeUndefined();
    // The host answers Chat and Anthropic; omp's registry speaks both, and the
    // probe's first match wins — so the landing protocol is one the HOST proved.
    expect(['openai-chat', 'anthropic-messages']).toContain(payload.protocol ?? '');
    expect(payload.imported?.id).toBe('stub-gateway');

    const text = fs.readFileSync(path.join(ROOT, '.omp/agent/models.yml'), 'utf8');
    expect(text).toContain('stub-gateway:');
    expect(text).toContain(`baseUrl: ${baseUrl}`);
    expect(text).toContain('apiKey: sk-add-test');
    // The display name survives the write — the card would otherwise print the
    // slug back and look like the form ignored what was typed.
    expect(text).toContain('name: Stub Gateway');
  });

  test('the ADDRESSED harness gets it, not omp', async () => {
    await call(action, post({
      probe: 'pi',
      addProvider: { name: 'Pi Gateway', baseUrl, apiKey: 'sk-pi' },
    }));
    const piFile = path.join(ROOT, '.pi/agent/models.json');
    expect(fs.existsSync(piFile)).toBe(true);
    const doc = JSON.parse(fs.readFileSync(piFile, 'utf8'));
    expect(doc.providers['pi-gateway'].baseUrl).toBe(baseUrl);
    // And omp's file is untouched by that write.
    expect(fs.readFileSync(path.join(ROOT, '.omp/agent/models.yml'), 'utf8')).not.toContain('pi-gateway');
  });

  test('a name that derives a VENDOR id is refused, naming the entry', async () => {
    // `Anthropic` would override the agent's own built-in provider.
    const response = await call(action, post({
      probe: 'omp-acp',
      addProvider: { name: 'Anthropic', baseUrl, apiKey: 'sk-x' },
    }));
    const payload = await response.json() as { error?: string };
    expect(response.status).toBe(400);
    expect(payload.error ?? '').toContain('ships itself');
    expect(isVendorProviderId('anthropic')).toBe(true);
  });

  test('a protocol the target cannot speak is refused BY NAME', async () => {
    // codex is Responses-only, and the stub does not answer `/v1/responses`.
    const response = await call(action, post({
      probe: 'codex',
      addProvider: { name: 'Chat Only', baseUrl, apiKey: 'sk-x' },
    }));
    const payload = await response.json() as { error?: string; code?: string; probe?: { protocols: string[] } };
    expect(response.status).toBe(400);
    expect(payload.code).toBe('no_shared_protocol');
    expect(payload.error ?? '').toContain('codex');
    // The evidence travels, so the reader can check the claim.
    expect(payload.probe?.protocols).toContain('anthropic-messages');
  });
});

describe('a provider with no models says so', () => {
  test('the write reports that nothing will be served, rather than a bare success', async () => {
    // Measured: omp serves zero rows from an entry with no models and no
    // `discovery` block, and prints no warning at all.
    const response = await call(action, post({
      probe: 'omp-acp',
      addProvider: { name: 'Empty Gateway', baseUrl, apiKey: 'sk-empty' },
    }));
    const notes = ((await response.json()) as { imported?: { notes: string[] } }).imported?.notes ?? [];
    expect(notes.join(' ')).toContain('serves nothing');
  });

  test('a provider WITH models gets no such note', async () => {
    const response = await call(action, post({
      probe: 'omp-acp',
      addProvider: { name: 'Full Gateway', baseUrl, apiKey: 'sk-full', models: ['m-1'] },
    }));
    const notes = ((await response.json()) as { imported?: { notes: string[] } }).imported?.notes ?? [];
    expect(notes.join(' ')).not.toContain('serves nothing');
  });
});

describe('adding a provider to an environment harness', () => {
  test('claude gets the vendor variables at the HOST ROOT, key and model included', async () => {
    const response = await call(action, post({
      probe: 'claude',
      addProvider: { name: 'Stub Anthropic', baseUrl, apiKey: 'sk-claude', models: ['claude-sonnet-5'] },
    }));
    const payload = await response.json() as { config?: { env: string }; envWritten?: string[]; error?: string };
    expect(payload.error).toBeUndefined();
    expect(payload.envWritten).toEqual([
      'ANTHROPIC_BASE_URL',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
    ]);
    // `/v1` stripped: the SDK appends `/v1/messages` itself.
    expect(payload.config?.env).toContain(`ANTHROPIC_BASE_URL=${baseUrl.replace(/\/v1$/, '')}`);
    expect(payload.config?.env).toContain('ANTHROPIC_AUTH_TOKEN=sk-claude');
    expect(payload.config?.env).toContain('ANTHROPIC_MODEL=claude-sonnet-5');
    // The picker's `sonnet` alias now resolves to the id this endpoint serves;
    // unpinned it would send the literal alias and answer 400.
    expect(payload.config?.env).toContain('ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-5');
  });

  test('no name is refused before anything is written', async () => {
    const response = await call(action, post({
      probe: 'claude',
      addProvider: { name: '   ', baseUrl, apiKey: 'sk-x' },
    }));
    expect(response.status).toBe(400);
    expect((await response.json() as { error?: string }).error).toContain('name');
  });
});

describe('the card can SEE what it added', () => {
  test('the loader lists the harness own custom providers', async () => {
    await call(action, post({
      probe: 'omp-acp',
      addProvider: { name: 'Visible Gateway', baseUrl, apiKey: 'sk-visible' },
    }));
    const payload = await (await call(loader, new Request(API))).json() as {
      providerSupport: Record<string, { configured: Array<{ id: string; hasKey: boolean }> }>;
    };
    const configured = payload.providerSupport['omp-acp']?.configured ?? [];
    expect(configured.map((row) => row.id)).toContain('visible-gateway');
    expect(configured.find((row) => row.id === 'visible-gateway')?.hasKey).toBe(true);
    // The credential never travels with the row.
    expect(JSON.stringify(configured)).not.toContain('sk-visible');
  });
});
