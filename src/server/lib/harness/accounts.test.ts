import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import {
  createHarnessAccount,
  removeHarnessAccount,
  renameHarnessAccount,
  resolveAccountLaunch,
  selectHarnessAccount,
  selectedAccountId,
  verifyHarnessAccount,
} from '@/server/lib/harness/accounts.server';
import { EMPTY_HARNESS_CONFIG } from '@kabmo-labs/kabmo-harness-config';

const roots: string[] = [];
const savedDataDir = Bun.env.KABMO_DATA_DIR;
const savedDbPath = Bun.env.KABMO_DB_PATH;

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

beforeEach(async () => {
  await isolateDb();
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-accounts-'));
  roots.push(dir);
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(async () => {
  await releaseDb();
  if (savedDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete Bun.env.KABMO_DB_PATH;
  else Bun.env.KABMO_DB_PATH = savedDbPath;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('saved harness accounts', () => {
  test('a new account creates an owned home and becomes active when none is', async () => {
    const state = await createHarnessAccount('codex', 'Work');
    const account = state.accounts[0];
    expect(account?.label).toBe('Work');
    expect(account?.harness).toBe('codex');
    expect(existsSync(join(account!.homePath, '.kabmo-account'))).toBe(true);
    expect(state.selected.codex).toBe(account!.id);
    expect(await selectedAccountId('codex')).toBe(account!.id);
  });

  test('launch env and the strip list come from the active account', async () => {
    const state = await createHarnessAccount('codex', 'Work');
    const home = state.accounts[0]!.homePath;
    const launch = await resolveAccountLaunch('codex', EMPTY_HARNESS_CONFIG);
    expect(launch.env?.CODEX_HOME).toBe(home);
    expect(launch.stripEnv).toContain('CODEX_HOME');
    expect(launch.stripEnv).toContain('OPENAI_API_KEY');
  });

  test('system default keeps the host login and injects no home', async () => {
    await createHarnessAccount('codex', 'Work');
    const state = await selectHarnessAccount('codex', null);
    expect(state.selected.codex ?? null).toBeNull();
    const launch = await resolveAccountLaunch('codex', EMPTY_HARNESS_CONFIG);
    expect(launch.env?.CODEX_HOME).toBeUndefined();
    expect(launch.stripEnv).toBeUndefined();
  });

  test('Verify reads the CLI token and names the account', async () => {
    const created = await createHarnessAccount('codex', 'Work');
    const account = created.accounts[0]!;
    writeFileSync(
      join(account.homePath, 'auth.json'),
      JSON.stringify({
        tokens: {
          id_token: jwt({ email: 'work@example.com' }),
          access_token: 'token',
          account_id: 'acct-1',
        },
      }),
    );
    const verified = await verifyHarnessAccount(account.id);
    expect(verified.signedIn).toBe(true);
    const row = verified.accounts.find((entry) => entry.id === account.id);
    expect(row?.signedIn).toBe(true);
    expect(row?.identity.email).toBe('work@example.com');
    expect(row?.identity.subject).toBe('acct-1');
  });

  test('Claude and Antigravity parse their own state files', async () => {
    const claude = await createHarnessAccount('claude', 'Personal');
    writeFileSync(
      join(claude.accounts[0]!.homePath, '.claude.json'),
      JSON.stringify({ oauthAccount: { emailAddress: 'me@example.com' } }),
    );
    const claudeState = await verifyHarnessAccount(claude.accounts[0]!.id);
    expect(claudeState.accounts[0]?.identity.email).toBe('me@example.com');

    const agy = await createHarnessAccount('antigravity', 'Google');
    const agyAccount = agy.accounts.find((entry) => entry.harness === 'antigravity')!;
    const acp = join(agyAccount.homePath, 'antigravity-acp');
    mkdirSync(acp, { recursive: true });
    writeFileSync(
      join(acp, 'acp_token.json'),
      JSON.stringify({
        token: { access_token: 'token' },
        id_token: jwt({
          iss: 'https://accounts.google.com',
          sub: 'google-1',
          email: 'g@example.com',
          email_verified: true,
        }),
      }),
    );
    const agyState = await verifyHarnessAccount(agyAccount.id);
    expect(agyState.signedIn).toBe(true);
    const agyRow = agyState.accounts.find((entry) => entry.id === agyAccount.id);
    expect(agyRow?.identity.email).toBe('g@example.com');
    expect(agyRow?.identity.subject).toBe('google-1');
  });

  test('rename is trimmed and an empty name is refused', async () => {
    const state = await createHarnessAccount('claude', 'Work');
    const id = state.accounts[0]!.id;
    expect((await renameHarnessAccount(id, '  Client  ')).accounts[0]?.label).toBe('Client');
    await expect(renameHarnessAccount(id, '   ')).rejects.toThrow('cannot be empty');
  });

  test('remove refuses a home whose marker belongs to another account', async () => {
    const state = await createHarnessAccount('codex', 'Work');
    const account = state.accounts[0]!;
    writeFileSync(join(account.homePath, '.kabmo-account'), 'someone-else\n');
    await expect(removeHarnessAccount(account.id)).rejects.toThrow('different account');
    expect(existsSync(account.homePath)).toBe(true);
  });

  test('remove deletes the owned home and clears the selection', async () => {
    const state = await createHarnessAccount('codex', 'Work');
    const account = state.accounts[0]!;
    const after = await removeHarnessAccount(account.id);
    expect(existsSync(account.homePath)).toBe(false);
    expect(after.accounts).toHaveLength(0);
    expect(after.selected.codex ?? null).toBeNull();
  });
});
