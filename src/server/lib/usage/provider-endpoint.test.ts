/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `resolveProviderEndpoint` is the half `resolveApiKey` cannot answer: a relay
 * serves its usage API at the base URL the user registered, so the endpoint has
 * to be read from the same store as the key. These tests pin which store wins
 * and what counts as a usable pair.
 */

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getDb } from '@/server/db.server';
import { resolveProviderEndpoint } from '@/server/lib/usage/provider-key';
import { removeDir } from '@/test-support/remove-dir';

const dirs: string[] = [];
let agentDir = '';
let realAgentDir: string | undefined;

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-endpoint-'));
  dirs.push(dir);
  return dir;
}

beforeAll(() => {
  agentDir = tempDir();
  realAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  writeFileSync(join(agentDir, 'models.yml'), 'providers: {}\n');
});

afterAll(() => {
  if (realAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = realAgentDir;
  for (const dir of dirs.splice(0)) removeDir(dir);
});

afterEach(() => {
  globalThis.__kabmoDb?.resolved?.raw.close();
  globalThis.__kabmoDb = undefined;
  delete Bun.env.KABMO_DB_PATH;
  writeFileSync(join(agentDir, 'models.yml'), 'providers: {}\n');
  rmSync(join(agentDir, 'agent.db'), { force: true });
});

function useTempDb(): void {
  Bun.env.KABMO_DB_PATH = join(tempDir(), 'db.sqlite');
  Bun.env.SYNC_WORKSPACE = 'false';
  delete Bun.env.MOCK;
  globalThis.__kabmoDb = undefined;
}

async function writeOverlayValue(value: string): Promise<void> {
  const db = await getDb();
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', ['omp_providers_config', value]);
}

describe('resolveProviderEndpoint', () => {
  test('reads the key and endpoint from the provider own models.yml entry', async () => {
    useTempDb();
    writeFileSync(
      join(agentDir, 'models.yml'),
      'providers:\n  aihub-brisnets-jatis:\n    baseUrl: https://aihub.brisnets.com/v1\n    apiKey: sk-live\n',
    );

    expect(await resolveProviderEndpoint('aihub-brisnets-jatis')).toEqual({
      apiKey: 'sk-live',
      baseUrl: 'https://aihub.brisnets.com/v1',
    });
  });

  test('the Kabmo overlay wins when it holds both a key and an endpoint', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'AI HUB', slug: 'aihub', baseUrl: 'https://aihub.brisnets.com/v1', apiKey: 'overlay-key' },
    ]));
    writeFileSync(
      join(agentDir, 'models.yml'),
      'providers:\n  aihub:\n    baseUrl: https://aihub.brisnets.com/v1\n    apiKey: yml-key\n',
    );

    expect(await resolveProviderEndpoint('aihub')).toEqual({
      apiKey: 'overlay-key',
      baseUrl: 'https://aihub.brisnets.com/v1',
    });
  });

  test('a masked overlay key is not a credential', async () => {
    useTempDb();
    await writeOverlayValue(JSON.stringify([
      { name: 'AI HUB', slug: 'aihub', baseUrl: 'https://aihub.brisnets.com/v1', apiKey: '••••••••' },
    ]));
    writeFileSync(join(agentDir, 'models.yml'), 'providers:\n  aihub:\n    apiKey: yml-key\n');

    // The overlay row cannot supply a key, and models.yml carries no baseUrl,
    // so there is no endpoint to resolve — not a half-valid pair.
    expect(await resolveProviderEndpoint('aihub')).toBeNull();
  });
});
