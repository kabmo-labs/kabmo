/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Two read-only ports of omp's own state: the managed-project registry and the
 * provider credentials.
 *
 * The registry is what the sidebar composes from, so its parser has to be
 * forgiving (a corrupt `projects.json` must not blank the whole sidebar) and
 * its merge has to be exact: registered entries first in sortOrder /
 * most-recently-added order, hidden entries suppressed, session-discovered
 * extras last, sorted. Credential resolution is equally load-bearing for the
 * usage surfaces: models.yml wins over agent.db, disabled credentials are
 * invisible, and only slugs — never key material — leave this layer. Every
 * store lives in a temp agent dir; the real one is never read or written.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { mergeProjects, parseProjectRegistry, loadProjectRegistry } from '@/server/lib/omp/core/registry';
import {
  listAgentDbCredentialSlugs,
  listModelsYmlCredentialSlugs,
  readOmpProviderApiKey,
} from '@/server/lib/omp/core/auth-credentials';

const realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
let agentDir = '';

function setupAgentDir(): string {
  agentDir = mkdtempSync(path.join(tmpdir(), 'kabmo-test-agent-'));
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  return agentDir;
}

function writeModelsYml(body: string): void {
  writeFileSync(path.join(agentDir, 'models.yml'), body);
}

function writeAgentDb(rows: Array<{ provider: string; type: string; disabled: string | null; data: string }>): void {
  const db = new Database(path.join(agentDir, 'agent.db'), { create: true });
  db.exec(`CREATE TABLE auth_credentials (
    provider TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    disabled_cause TEXT,
    data TEXT NOT NULL
  )`);
  const insert = db.query('INSERT INTO auth_credentials (provider, credential_type, disabled_cause, data) VALUES (?, ?, ?, ?)');
  for (const row of rows) insert.run(row.provider, row.type, row.disabled, row.data);
  db.close();
}

afterEach(() => {
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  if (agentDir) rmSync(agentDir, { recursive: true, force: true });
  agentDir = '';
});

describe('parseProjectRegistry', () => {
  test('keeps well-formed entries and canonicalizes their path', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kabmo-test-proj-'));
    const registry = parseProjectRegistry(
      JSON.stringify({
        version: 1,
        projects: [{ path: dir, addedAt: '2026-01-01T00:00:00Z', alias: '  work  ', sortOrder: 2, hidden: false }],
      }),
    );
    rmSync(dir, { recursive: true, force: true });
    expect(registry.version).toBe(1);
    expect(registry.projects).toHaveLength(1);
    expect(registry.projects[0]!.alias).toBe('work');
    expect(registry.projects[0]!.sortOrder).toBe(2);
    expect(registry.projects[0]!.hidden).toBe(false);
    expect(registry.projects[0]!.addedAt).toBe('2026-01-01T00:00:00Z');
  });

  test('drops entries without a usable string path and foreign shapes', () => {
    const registry = parseProjectRegistry(
      JSON.stringify({ projects: [{ path: 42 }, { path: '   ' }, {}, { path: '/ok' }, null, 'x'] }),
    );
    expect(registry.projects.map((p) => p.path)).toEqual(['/ok']);
  });

  test('a blank alias and a non-finite sortOrder are omitted', () => {
    const registry = parseProjectRegistry(JSON.stringify({ projects: [{ path: '/a', alias: '  ', sortOrder: Number.NaN }] }));
    expect(registry.projects[0]!.alias).toBeUndefined();
    expect(registry.projects[0]!.sortOrder).toBeUndefined();
  });

  test('hidden is true only for the literal boolean', () => {
    const registry = parseProjectRegistry(JSON.stringify({ projects: [{ path: '/a', hidden: 'yes' }, { path: '/b', hidden: true }] }));
    expect(registry.projects.map((p) => p.hidden)).toEqual([false, true]);
  });

  test('corrupt JSON, arrays and objects without projects yield an empty registry', () => {
    for (const raw of ['not json', '[]', 'null', '"str"', '{}', '{"projects":{}}']) {
      expect(parseProjectRegistry(raw)).toEqual({ version: 1, projects: [] });
    }
  });
});

describe('loadProjectRegistry', () => {
  test('a missing file is an empty registry', async () => {
    expect(await loadProjectRegistry('/definitely/missing/projects.json')).toEqual({ version: 1, projects: [] });
  });

  test('reads a real file and tolerates a corrupt one', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kabmo-test-reg-'));
    const good = path.join(dir, 'good.json');
    const bad = path.join(dir, 'bad.json');
    writeFileSync(good, JSON.stringify({ projects: [{ path: '/p' }] }));
    writeFileSync(bad, '{ broken');
    expect((await loadProjectRegistry(good)).projects).toHaveLength(1);
    expect(await loadProjectRegistry(bad)).toEqual({ version: 1, projects: [] });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('mergeProjects', () => {
  const registry = (projects: Array<Record<string, unknown>>) => ({ version: 1 as const, projects: projects as never });

  test('registered entries sort by sortOrder, then most-recently-added', () => {
    const merged = mergeProjects(
      registry([
        { path: '/b', addedAt: '2026-01-01T00:00:00Z' },
        { path: '/a', sortOrder: 5 },
        { path: '/c', addedAt: '2026-02-01T00:00:00Z' },
      ]),
      [],
    );
    expect(merged.map((p) => p.path)).toEqual(['/a', '/c', '/b']);
    expect(merged.every((p) => !p.discovered)).toBe(true);
  });

  test('hidden entries are excluded and suppress rediscovery of the same path', () => {
    const merged = mergeProjects(registry([{ path: '/hidden', hidden: true }, { path: '/shown' }]), ['/hidden', '/new']);
    expect(merged.map((p) => p.path)).toEqual(['/shown', '/new']);
    expect(merged.find((p) => p.path === '/new')!.discovered).toBe(true);
  });

  test('discovered extras follow the registered ones, sorted by path', () => {
    // The discovered paths route through `canonicalize` (realpath); a bare `/a`
    // on Windows resolves against the CURRENT drive and, on the runner, collides
    // with the real `D:\a`. A temp-rooted path that does not exist stays verbatim
    // on every host, so the sort/cull under test is what the case observes.
    const [z, a, m] = ['z', 'a', 'm'].map((s) => path.join(tmpdir(), `kabmo-merge-${s}`));
    const merged = mergeProjects(registry([{ path: z }]), [m, a]);
    expect(merged.map((p) => p.path)).toEqual([z, a, m]);
  });

  test('a discovered path already registered is not repeated', () => {
    const merged = mergeProjects(registry([{ path: '/same' }]), ['/same']);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.discovered).toBe(false);
  });

  test('duplicate and blank discovered paths collapse', () => {
    const [a, b] = ['a', 'b'].map((s) => path.join(tmpdir(), `kabmo-merge-${s}`));
    const merged = mergeProjects(registry([]), [a, a, '', b]);
    expect(merged.map((p) => p.path)).toEqual([a, b]);
  });
});

describe('readOmpProviderApiKey', () => {
  test('an absent agent dir resolves to null', async () => {
    setupAgentDir();
    expect(await readOmpProviderApiKey('deepseek')).toBeNull();
  });

  test('reads providers.<slug>.apiKey from models.yml, trimmed', async () => {
    setupAgentDir();
    writeModelsYml('providers:\n  deepseek:\n    apiKey: "  sk-abc  "\n  blank:\n    apiKey: "   "\n');
    expect(await readOmpProviderApiKey('deepseek')).toBe('sk-abc');
    expect(await readOmpProviderApiKey('blank')).toBeNull();
    expect(await readOmpProviderApiKey('missing')).toBeNull();
  });

  test('falls back to the enabled api_key credential in agent.db', async () => {
    setupAgentDir();
    writeAgentDb([
      { provider: 'openai', type: 'api_key', disabled: null, data: JSON.stringify({ key: '  sk-db  ' }) },
    ]);
    expect(await readOmpProviderApiKey('openai')).toBe('sk-db');
  });

  test('models.yml takes precedence over agent.db', async () => {
    setupAgentDir();
    writeModelsYml('providers:\n  deepseek:\n    apiKey: from-yml\n');
    writeAgentDb([{ provider: 'deepseek', type: 'api_key', disabled: null, data: JSON.stringify({ key: 'from-db' }) }]);
    expect(await readOmpProviderApiKey('deepseek')).toBe('from-yml');
  });

  test('a disabled credential, a non-api_key type and a malformed blob are all misses', async () => {
    setupAgentDir();
    writeAgentDb([
      { provider: 'a', type: 'api_key', disabled: 'revoked', data: JSON.stringify({ key: 'x' }) },
      { provider: 'b', type: 'oauth', disabled: null, data: JSON.stringify({ key: 'x' }) },
      { provider: 'c', type: 'api_key', disabled: null, data: '{ broken' },
      { provider: 'd', type: 'api_key', disabled: null, data: JSON.stringify({ key: '' }) },
    ]);
    for (const slug of ['a', 'b', 'c', 'd']) expect(await readOmpProviderApiKey(slug)).toBeNull();
  });
});

describe('credential slug listings', () => {
  test('listModelsYmlCredentialSlugs returns only keyed slugs, lowercased', async () => {
    setupAgentDir();
    writeModelsYml('providers:\n  DeepSeek:\n    apiKey: k\n  Empty:\n    apiKey: "  "\n  Other:\n    baseUrl: http://x\n');
    expect(await listModelsYmlCredentialSlugs()).toEqual(['deepseek']);
  });

  test('listAgentDbCredentialSlugs returns enabled providers only, lowercased', async () => {
    setupAgentDir();
    writeAgentDb([
      { provider: 'OpenAI', type: 'api_key', disabled: null, data: '{}' },
      { provider: 'anthropic', type: 'api_key', disabled: 'revoked', data: '{}' },
      { provider: 'gemini', type: 'oauth', disabled: null, data: '{}' },
    ]);
    expect(await listAgentDbCredentialSlugs()).toEqual(['openai', 'gemini']);
  });

  test('a missing agent dir yields no slugs', async () => {
    setupAgentDir();
    expect(await listModelsYmlCredentialSlugs()).toEqual([]);
    expect(await listAgentDbCredentialSlugs()).toEqual([]);
  });
});
