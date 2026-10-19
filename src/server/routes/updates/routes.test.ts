/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `/api/updates/*` request contract.
 *
 * `apply` is the only endpoint that can replace the running install, so its
 * refusals are pinned individually: a body that is not JSON, a target that is
 * not one of the two known ones, and a second run while one is in flight (the
 * 409 that keeps two `git merge`/`omp update` children out of the same
 * checkout). The mock stream is asserted frame-by-frame because it is what the
 * console renders in demo mode.
 *
 * `check` and `changelog` must never answer 500 — the popup opens from them —
 * so both are exercised through a stubbed GitHub read: a real release makes
 * `check` report `updateAvailable: true` with the release fields filled, and
 * the omp half is forced to "binary not found" so no omp child is spawned.
 */

import packageJson from '@/../package.json';
import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { action as applyUpdateRoute } from '@/server/routes/updates/apply';
import { invalidateOmpCliCache } from '@/server/lib/omp/core/cli';
import { loader as checkRoute } from '@/server/routes/updates/check';
import { loader as changelogRoute } from '@/server/routes/updates/changelog';
import { readInstalledVersion } from '@/server/lib/updates/install';
import { runningUpdate, withUpdateSlot } from '@/server/lib/updates/single-flight';

/** The runner's own fetch, reached through `Bun` so a stub leaked onto the global cannot be mistaken for it. */
const originalFetch = Bun.fetch;
const MISSING_OMP = '/nonexistent/omc-updates-test/omp';
/** The suite mutates process-wide env; restore what was there, not just delete. */
const ORIGINAL_ENV = { MOCK: Bun.env.MOCK, KABMO_OMP_BIN: Bun.env.KABMO_OMP_BIN };

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
}

function request(method: string, body?: string): Request {
  return new Request('http://localhost/api/updates/apply', { method, ...(body === undefined ? {} : { body }) });
}

async function payload(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** Narrow one field of a JSON payload to a record without an inline cast. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The changelog cache hangs off globalThis; a stubbed page must not leak into a sibling suite. */
const globalWithCache = globalThis as { __kabmoChangelogCache?: unknown };

/** A published version manifest, the shape `/latest` answers. */
function versionJson(version: string): Record<string, unknown> {
  return { name: packageJson.name, version, dist: { tarball: `https://registry.npmjs.org/${packageJson.name}/-/${packageJson.name}-${version}.tgz` } };
}

/** A changelog shaped like the repository's own, for the notes range. */
const CHANGELOG_MARKDOWN = [
  '# Changelog',
  '',
  '## [999.0.0](https://github.com/kabmo-labs/kabmo/compare/v998.0.0...v999.0.0) — 2026-01-01',
  '',
  '### Added',
  '',
  '* a thing',
  '',
].join('\n');

/**
 * The two network reads, stubbed: npm's `/latest` manifest for the versions, and
 * the repository's CHANGELOG.md for the notes. A stub that answered both with the
 * same body would make the notes look like a fetch failure.
 */
function updatesFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  if (url.includes('CHANGELOG')) {
    return Promise.resolve(new Response(CHANGELOG_MARKDOWN, { status: 200, headers: { 'content-type': 'text/markdown' } }));
  }
  // The update check asks the renamed package FIRST. Answering it with a
  // version would make this copy look renamed; the stub speaks for the one
  // package actually installed here.
  if (!url.includes(`/${packageJson.name}/latest`)) {
    return Promise.resolve(new Response('{}', { status: 404 }));
  }
  return Promise.resolve(
    new Response(JSON.stringify(versionJson('999.0.0')), { status: 200, headers: { 'content-type': 'application/json' } }),
  );
}

beforeEach(() => {
  // No omp child may be spawned: the override path does not exist, so
  // `resolveOmpBin()` answers null and the omp probe stops before any spawn.
  Bun.env.KABMO_OMP_BIN = MISSING_OMP;
  invalidateOmpCliCache();
});

afterEach(() => {
  restoreEnv();
  globalThis.fetch = originalFetch;
  // `fetchChangelogNotes` caches on globalThis, so a stubbed page must not leak.
  delete globalWithCache.__kabmoChangelogCache;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/updates/apply refusals', () => {
  test('a wrong verb is a 405', async () => {
    const res = (await applyUpdateRoute({ request: request('GET'), params: {} } as never)) as Response;
    expect(res.status).toBe(405);
    expect((await payload(res)).error).toBe('Method not allowed');
  });

  test('a body that is not JSON is a 400, not a stream', async () => {
    const res = (await applyUpdateRoute({ request: request('POST', 'not json'), params: {} } as never)) as Response;
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe('Request body is not valid JSON');
  });

  test('a target outside the two known ones is a 400', async () => {
    for (const target of ['', 'kabmo2', 7, null, undefined]) {
      const res = (await applyUpdateRoute({
        request: request('POST', JSON.stringify({ target })),
        params: {},
      } as never)) as Response;
      expect(res.status).toBe(400);
      expect((await payload(res)).error).toBe('Unknown update target');
    }
  });

  test('a second run while one is in flight is a 409', async () => {
    let release!: () => void;
    const held = withUpdateSlot('omp', () => new Promise<void>((resolve) => (release = resolve)));
    try {
      expect(runningUpdate()).toBe('omp');
      const res = (await applyUpdateRoute({
        request: request('POST', JSON.stringify({ target: 'kabmo' })),
        params: {},
      } as never)) as Response;
      expect(res.status).toBe(409);
      expect((await payload(res)).error).toBe('An Oh-My-Pi update is already running.');
    } finally {
      release();
      await held;
    }
    expect(runningUpdate()).toBeNull();
  });
});

describe('POST /api/updates/apply in MOCK mode', () => {
  beforeEach(() => {
    Bun.env.MOCK = '1';
  });

  test('answers an SSE stream shaped like a real run and says it was simulated', async () => {
    const res = (await applyUpdateRoute({
      request: request('POST', JSON.stringify({ target: 'kabmo' })),
      params: {},
    } as never)) as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('event: stage\ndata: "Simulating a Kabmo update"\n\n');
    expect(text).toContain('event: line\ndata: "[mock] no command was run; MOCK=true skips real updates\\n"\n\n');
    expect(text).toContain('event: result\ndata: {"success":true,"target":"kabmo","manual":false');
    expect(text).toContain('nothing was changed');
    // Nothing was spawned, and the slot is free again.
    expect(runningUpdate()).toBeNull();
  });

  test('labels the omp target by its product name', async () => {
    const res = (await applyUpdateRoute({
      request: request('POST', JSON.stringify({ target: 'omp' })),
      params: {},
    } as never)) as Response;
    const text = await res.text();
    expect(text).toContain('Simulating the Oh-My-Pi update');
    expect(text).toContain('"target":"omp"');
  });
});

describe('GET /api/updates/check', () => {
  test('reports the real release and the missing omp binary in one result', async () => {
    // Read from the package on disk, never pinned: the release job bumps the
    // version on every push to `main`, and this suite runs after it.
    const installed = await readInstalledVersion();
    expect(installed).toMatch(/^\d+\.\d+\.\d+/);
    globalThis.fetch = updatesFetch as typeof fetch;
    const res = (await checkRoute()) as unknown as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const result = await payload(res);
    expect(result.kabmo).toMatchObject({
      current: installed,
      latest: '999.0.0',
      updateAvailable: true,
      installed: true,
      error: null,
      releaseName: 'v999.0.0',
      releaseUrl: 'https://github.com/kabmo-labs/kabmo/releases/tag/v999.0.0',
    });
    // omp was forced absent, which must be a normal result, not a 500.
    expect(result.omp).toMatchObject({ current: null, latest: null, updateAvailable: false, installed: false });
    expect(asRecord(result.omp).error).toBe('omp binary not found');
    expect(Number.isNaN(Date.parse(String(result.checkedAt)))).toBe(false);
  });

  test('in MOCK mode the demo pair reports an update for both targets', async () => {
    Bun.env.MOCK = 'true';
    const res = (await checkRoute()) as unknown as Response;
    expect(res.status).toBe(200);
    const result = await payload(res);
    expect(result.kabmo).toMatchObject({ current: '3.6.0', latest: '3.8.0', updateAvailable: true });
    expect(result.omp).toMatchObject({ current: '18.3.0', latest: '18.4.0', updateAvailable: true });
  });
});

describe('GET /api/updates/changelog', () => {
  test('builds the release range from the installed version and the stub', async () => {
    globalThis.fetch = updatesFetch as typeof fetch;
    const res = (await changelogRoute()) as unknown as Response;
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const result = await payload(res);
    expect(result.current).toBe(await readInstalledVersion());
    expect(result.latest).toBe('999.0.0');
    expect(result.error).toBeNull();
    expect(result.truncated).toBe(false);
    expect(result.total).toBe(1);
    const versions = result.versions as Array<Record<string, unknown>>;
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version: '999.0.0',
      date: '2026-01-01',
      body: '### Added\n\n* a thing',
    });
    expect(result.releaseUrl).toBe('https://github.com/kabmo-labs/kabmo/releases/tag/v999.0.0');
    // How this copy updates itself is a fact about the install, always present.
    const install = asRecord(result.install);
    expect(typeof install.method).toBe('string');
    expect(typeof install.manual).toBe('boolean');
  });

  test('in MOCK mode serves the demo range without any network read', async () => {
    Bun.env.MOCK = '1';
    globalThis.fetch = (() => {
      throw new Error('network must not be reached in mock mode');
    }) as unknown as typeof fetch;
    const res = (await changelogRoute()) as unknown as Response;
    const result = await payload(res);
    expect(result.current).toBe('3.6.0');
    expect(result.latest).toBe('3.8.0');
    expect(result.versions as unknown[]).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.error).toBeNull();
  });
});
