/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/harness { importProvider }` — the one action the user asked for:
 * "claude pakai import provider kenari dari omp".
 *
 * Three facts make it honest, and each is asserted against a REAL registry file
 * in a temp HOME rather than a hand-built payload:
 *
 *  - the row the browser sends carries no credential; the route reads the key out
 *    of the SOURCE file in the same request that writes the target;
 *  - the endpoint is PROBED, and a protocol the target cannot speak is refused by
 *    name instead of being written as a guess (codex rejects `wire_api = "chat"`
 *    at config load, and Anthropic written as Chat fails every request);
 *  - an env target gets the vendor's own variables at the HOST ROOT, because the
 *    SDK appends `/v1/messages` itself — measured on Claude Code, which answered
 *    an empty turn against `https://kenari.id/v1`.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { restoreEnv } from '@/test-support/env';
import { action, loader } from '@/server/routes/harness/root';
import { loadHarnessConfig } from '@/server/lib/harness/config.server';

const ROOT = path.join(os.tmpdir(), 'kabmo-harness-import-route');
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

const MODELS_YML = `providers:
  kenari:
    baseUrl: https://kenari.id/v1
    apiKey: kn-route-test
    api: openai-completions
    models:
      - id: claude-sonnet-5
        contextWindow: 1000000
  anthropic:
    baseUrl: https://api.anthropic.com/v1
    api: anthropic-messages
    models: []
`;

const savedHome = Bun.env.HOME;
let stub: { port?: number; stop(force?: boolean): void } | null = null;
let baseUrl = '';

beforeAll(() => {
  fs.mkdirSync(path.join(ROOT, '.omp/agent'), { recursive: true });
  Bun.env.HOME = ROOT;
  Bun.env.KABMO_TEST_HOME = ROOT;
  fs.writeFileSync(path.join(ROOT, '.omp/agent/models.yml'), MODELS_YML);
});

beforeEach(async () => {
  await isolateDb();
  // A stub host shaped like the measured one: Anthropic Messages and OpenAI Chat
  // answer a malformed body, the Gemini listing and `/v1/responses` do not.
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
      return new Response('<!DOCTYPE html><html></html>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      });
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

describe('importing a custom provider into claude', () => {
  test('the vendor’s own variables are written at the HOST ROOT, and the key is read server-side', async () => {
    const entry = {
      name: 'Kenari',
      // The stub stands in for the host; its shape is what the probe measures.
      baseUrl,
      protocol: 'openai-chat',
      models: ['claude-sonnet-5'],
      contextWindow: { 'claude-sonnet-5': 1_000_000 },
    };
    const response = await call(action, post({
      probe: 'claude',
      importProvider: { from: 'omp-rpc', id: 'kenari', entry },
    }));
    const payload = await response.json() as {
      config?: { env: string };
      envWritten?: string[];
      protocol?: string;
      error?: string;
    };
    expect(payload.error).toBeUndefined();
    // The probe found Anthropic Messages on the host and Claude Code speaks it,
    // even though the source declares openai-completions.
    expect(payload.protocol).toBe('anthropic-messages');
    expect(payload.envWritten).toEqual(
      ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'],
    );
    // The stub's `/v1` is stripped: the SDK appends `/v1/messages` itself.
    expect(payload.config?.env).toContain(`ANTHROPIC_BASE_URL=${baseUrl.replace(/\/v1$/, '')}`);
    // The credential came from the SOURCE file, never from the request body.
    expect(payload.config?.env).toContain('ANTHROPIC_AUTH_TOKEN=kn-route-test');
    // A Sonnet id, not the source's first row: measured, kenari lists
    // `agnes-2-5-flash:free` first and Claude Code logged `unrecognized_model`.
    expect(payload.config?.env).toMatch(/ANTHROPIC_MODEL=claude-sonnet-5/);
    // And it is what the spawn will read, not a value only the response held.
    const saved = await loadHarnessConfig('claude');
    expect(saved.env).toBe(payload.config?.env ?? '');
  });

  test('a host that speaks nothing this target speaks is refused BY NAME', async () => {
    const response = await call(action, post({
      probe: 'antigravity',
      importProvider: {
        from: 'omp-rpc',
        id: 'kenari',
        entry: { name: 'Kenari', baseUrl, protocol: 'openai-chat', models: ['m'] },
      },
    }));
    const payload = await response.json() as { error?: string; code?: string; probe?: { protocols: string[] } };
    expect(response.status).toBe(400);
    expect(payload.code).toBe('no_shared_protocol');
    // The refusal names what the endpoint DOES answer, so the reader can see why.
    expect(payload.error).toContain('anthropic-messages');
    expect(payload.error).toContain('openai-chat');
    expect(payload.probe?.protocols).toEqual(['openai-chat', 'anthropic-messages']);
  });

  test('a VENDOR provider is not in the import list at all', async () => {
    const response = await call(loader, new Request(API));
    const payload = await response.json() as {
      providerSupport: Record<string, { importable: Array<{ id: string; source: string }> }>;
    };
    const ids = payload.providerSupport.claude?.importable.map((row) => row.id) ?? [];
    expect(ids).toContain('kenari');
    // `anthropic` is in the same models.yml and must never be offered: copying it
    // into another agent overrides that agent's own built-in provider.
    expect(ids).not.toContain('anthropic');
  });

  test('the card is told the target’s protocols and the source’s, not a guess', async () => {
    // The row is offered even though its DECLARED protocol is not one claude
    // speaks: the probe is what decides, and it is the route's job — the loader
    // refusing here would have hidden the one import that works.
    const response = await call(loader, new Request(API));
    const payload = await response.json() as {
      providerSupport: Record<string, {
        protocols: string[];
        importable: Array<{ id: string; protocol?: string }>;
      }>;
    };
    const claude = payload.providerSupport.claude!;
    expect(claude.protocols).toEqual(['anthropic-messages']);
    expect(claude.importable.find((row) => row.id === 'kenari')?.protocol).toBe('openai-chat');
    // codex stores Responses only, so its list says so.
    expect(payload.providerSupport.codex?.protocols).toEqual(['openai-responses']);
  });
});
