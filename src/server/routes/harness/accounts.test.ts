import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { action, loader } from '@/server/routes/harness/root';

type Handler = (args: never) => unknown;
const roots: string[] = [];
const savedDataDir = Bun.env.KABMO_DATA_DIR;

interface AccountRow {
  id: string;
  harness: string;
  label: string;
  homePath: string;
  loginCommand: string;
}
interface AccountResponse {
  accounts?: AccountRow[];
  selected?: Record<string, string | null>;
  createdId?: string;
  error?: string;
}
interface CatalogResponse {
  accounts?: { harness: string; label: string }[];
  accountSelection?: Record<string, string | null>;
}

function post(account: Record<string, unknown>): Promise<Response> {
  return (action as Handler)({
    request: new Request('http://localhost/api/harness', {
      method: 'POST',
      body: JSON.stringify({ account }),
      headers: { 'content-type': 'application/json' },
    }),
    params: {},
  } as never) as Promise<Response>;
}

beforeEach(async () => {
  await isolateDb();
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-account-route-'));
  roots.push(dir);
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(async () => {
  await releaseDb();
  if (savedDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = savedDataDir;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/harness account operations', () => {
  test('create, select, and remove answer the whole account state', async () => {
    const created = await post({ op: 'create', harness: 'codex', label: 'Work' });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as AccountResponse;
    const account = createdBody.accounts?.[0];
    expect(account?.loginCommand).toContain('CODEX_HOME=');
    expect(createdBody.selected?.codex).toBe(account?.id);

    const cleared = await post({ op: 'select', harness: 'codex', accountId: null });
    expect(cleared.status).toBe(200);
    const clearedBody = (await cleared.json()) as AccountResponse;
    expect(clearedBody.selected?.codex ?? null).toBeNull();

    const removed = await post({ op: 'remove', accountId: account!.id });
    expect(removed.status).toBe(200);
    const removedBody = (await removed.json()) as AccountResponse;
    expect(removedBody.accounts).toHaveLength(0);
  });

  test('GET /api/harness carries the saved accounts and selection', async () => {
    await post({ op: 'create', harness: 'claude', label: 'Personal' });
    const response = (await (loader as Handler)({
      request: new Request('http://localhost/api/harness'),
      params: {},
    } as never)) as Response;
    expect(response.status).toBe(200);
    const payload = (await response.json()) as CatalogResponse;
    expect(payload.accounts?.some((account) => account.harness === 'claude' && account.label === 'Personal'))
      .toBe(true);
    expect(payload.accountSelection?.claude).toBeTruthy();
  });

  test('an unknown operation and an unsupported harness are refused in words', async () => {
    const unknown = await post({ op: 'dance' });
    expect(unknown.status).toBe(400);
    const unknownBody = (await unknown.json()) as AccountResponse;
    expect(unknownBody.error).toContain('Unknown account operation');

    const unsupported = await post({ op: 'create', harness: 'opencode' });
    expect(unsupported.status).toBe(400);
    const unsupportedBody = (await unsupported.json()) as AccountResponse;
    expect(unsupportedBody.error).toContain('does not support');
  });
});
