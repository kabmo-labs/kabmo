/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saved CLI homes for Codex, Claude and Antigravity.
 *
 * A row is a pointer to a directory the agent itself owns. Kabmo creates the
 * directory with a marker, remembers which account is active, and resolves the
 * launch env from that row. It never stores the token: the CLI writes it.
 *
 * A missing or foreign marker is a refusal, not a directory to reuse. Writing a
 * login into a home this server cannot prove it created is how one account's
 * credential lands in another account's folder.
 */

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { getDb } from '@/server/db.server';
import { getDataDir } from '@/server/lib/lifecycle/paths';
import { forgetProbe } from '@/server/lib/harness/probe-cache.server';
import { readAccountIdentity } from '@/server/lib/harness/account-identity.server';
import { resolveLaunch } from '@/server/lib/harness/config.server';
import type { HarnessLaunch } from '@/server/lib/harness/launch-table';
import type { HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { HarnessConfig } from '@kabmo-labs/kabmo-harness-config';
import { accountAdapter,
accountLoginCommand,
type AccountHarness,
type HarnessAccountIdentity,
type HarnessAccountsState,
type HarnessAccountView, } from '@kabmo-labs/kabmo-harness-accounts';

interface AccountRow {
  id: string;
  harness: AccountHarness;
  label: string;
  home_path: string;
  identity: string;
  auth_kind: string;
  created_at: number;
  updated_at: number;
  verified_at: number;
}

const ACCOUNT_ID = /^[a-f0-9-]{36}$/;

export class HarnessAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HarnessAccountError';
  }
}

class AccountHomeGoneError extends HarnessAccountError {}

function parseIdentity(raw: string): HarnessAccountIdentity {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const source = value as Record<string, unknown>;
    return {
      ...(typeof source.email === 'string' ? { email: source.email } : {}),
      ...(typeof source.subject === 'string' ? { subject: source.subject } : {}),
      ...(typeof source.organization === 'string' ? { organization: source.organization } : {}),
    };
  } catch {
    return {};
  }
}

async function loadRows(): Promise<AccountRow[]> {
  const db = await getDb();
  return db.all<AccountRow>(
    `SELECT id, harness, label, home_path, identity, auth_kind, created_at, updated_at, verified_at
       FROM harness_accounts
      ORDER BY created_at ASC`,
  );
}

async function loadRow(id: string): Promise<AccountRow | null> {
  if (!ACCOUNT_ID.test(id)) return null;
  const db = await getDb();
  return (await db.get<AccountRow>(
    `SELECT id, harness, label, home_path, identity, auth_kind, created_at, updated_at, verified_at
       FROM harness_accounts WHERE id = ?`,
    [id],
  )) ?? null;
}

async function loadSelected(): Promise<Record<string, string | null>> {
  const db = await getDb();
  const rows = await db.all<{ harness: string; account_id: string }>(
    'SELECT harness, account_id FROM harness_account_selection',
  );
  return Object.fromEntries(rows.map((row) => [row.harness, row.account_id]));
}

async function saveSelection(harness: AccountHarness, accountId: string | null): Promise<void> {
  const db = await getDb();
  if (accountId === null) {
    await db.run('DELETE FROM harness_account_selection WHERE harness = ?', [harness]);
    return;
  }
  await db.run(
    'INSERT OR REPLACE INTO harness_account_selection (harness, account_id) VALUES (?, ?)',
    [harness, accountId],
  );
}

function homeFor(id: string): string {
  return join(getDataDir(), 'harness-accounts', id);
}

const markerFor = (id: string) => join(homeFor(id), '.kabmo-account');

async function assertHomeOwned(row: AccountRow): Promise<void> {
  if (resolve(row.home_path) !== resolve(homeFor(row.id))) {
    throw new HarnessAccountError(`The home for ${row.label} is outside Kabmo's account storage.`);
  }
  const marker = markerFor(row.id);
  let stored: string;
  try {
    stored = (await readFile(marker, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new HarnessAccountError(`The home for ${row.label} could not be read.`);
    }
    const present = await stat(homeFor(row.id)).then(() => true, () => false);
    if (!present) throw new AccountHomeGoneError(`The home for ${row.label} is gone.`);
    throw new HarnessAccountError(`The home for ${row.label} is missing its Kabmo marker.`);
  }
  if (stored !== row.id) {
    throw new HarnessAccountError(`The home for ${row.label} belongs to a different account.`);
  }
}

async function state(rows?: AccountRow[]): Promise<HarnessAccountsState> {
  const all = rows ?? (await loadRows());
  const selected = await loadSelected();
  const loginShell = process.platform === 'win32' ? 'win32' : 'posix';
  const accounts: HarnessAccountView[] = [];
  for (const row of all) {
    const adapter = accountAdapter(row.harness);
    if (!adapter) continue;
    let read;
    try {
      await assertHomeOwned(row);
      read = await readAccountIdentity(row.harness, row.home_path);
    } catch (error) {
      read = {
        identity: {},
        authKind: 'unknown',
        signedIn: false,
        detail: error instanceof Error ? error.message : 'This account home is unavailable.',
      };
    }
    const known = parseIdentity(row.identity);
    accounts.push({
      id: row.id,
      harness: row.harness,
      label: row.label,
      homePath: row.home_path,
      identity: read.signedIn
        ? (Object.keys(known).length > 0 ? known : read.identity)
        : {},
      authKind: read.authKind,
      signedIn: read.signedIn,
      detail: read.detail,
      loginCommand: accountLoginCommand(adapter, row.home_path, loginShell),
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
    });
  }
  const ids = new Set(accounts.map((account) => account.id));
  for (const [harness, id] of Object.entries(selected)) {
    if (id && !ids.has(id)) selected[harness] = null;
  }
  return { accounts, selected };
}

export async function listHarnessAccounts(): Promise<HarnessAccountsState> {
  return state();
}

/** Selected account for a harness, or null for the host login. */
export async function selectedAccountId(harness: string): Promise<string | null> {
  const selected = await loadSelected();
  const id = selected[harness];
  if (!id) return null;
  const row = await loadRow(id);
  return row?.harness === harness ? row.id : null;
}

/**
 * The launch line a spawn uses, with the selected or named account applied.
 *
 * `accountId` undefined means "the selected account"; null means "the host
 * login" and is what a chat resumed from a pre-account row passes.
 */
export async function resolveAccountLaunch(
  harness: string,
  config: HarnessConfig,
  accountId?: string | null,
): Promise<HarnessLaunch> {
  const launch = resolveLaunch(harness as HarnessId, config);
  const adapter = accountAdapter(harness);
  if (!adapter) return launch;
  const id = accountId === undefined ? await selectedAccountId(harness) : accountId;
  if (!id) return launch;
  const row = await loadRow(id);
  if (!row || row.harness !== harness) {
    throw new HarnessAccountError('The selected account no longer exists.');
  }
  await assertHomeOwned(row);
  return {
    ...launch,
    env: { ...(launch.env ?? {}), ...adapter.env(row.home_path) },
    stripEnv: [...new Set([...(launch.stripEnv ?? []), ...adapter.stripEnv])],
  };
}

export interface HarnessAccountTarget {
  id: string;
  harness: AccountHarness;
  label: string;
  homePath: string;
}

/** The home a login process should run in, after the ownership check. */
export async function harnessAccountTarget(accountId: string): Promise<HarnessAccountTarget> {
  const row = await loadRow(accountId);
  if (!row) throw new HarnessAccountError('That account no longer exists.');
  await assertHomeOwned(row);
  return { id: row.id, harness: row.harness, label: row.label, homePath: row.home_path };
}

export async function createHarnessAccount(
  harness: string,
  label?: string,
): Promise<HarnessAccountsState & { createdId: string }> {
  const adapter = accountAdapter(harness);
  if (!adapter) throw new HarnessAccountError(`${harness} does not support saved accounts.`);
  const id = crypto.randomUUID();
  const home = homeFor(id);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await writeFile(markerFor(id), `${id}\n`, { mode: 0o600 });
  const now = Date.now();
  const db = await getDb();
  const count = await db.get<{ n: number }>(
    'SELECT COUNT(*) AS n FROM harness_accounts WHERE harness = ?',
    [harness],
  );
  const name = label?.trim().slice(0, 80) || `${adapter.label} account ${(count?.n ?? 0) + 1}`;
  await db.run(
    `INSERT INTO harness_accounts
       (id, harness, label, home_path, identity, auth_kind, created_at, updated_at, verified_at)
     VALUES (?, ?, ?, ?, '{}', 'unknown', ?, ?, 0)`,
    [id, harness, name, home, now, now],
  );
  if (!(await selectedAccountId(harness))) await saveSelection(adapter.harness, id);
  await forgetProbe(adapter.harness);
  return { ...(await state()), createdId: id };
}

export async function selectHarnessAccount(
  harness: string,
  accountId: string | null,
): Promise<HarnessAccountsState> {
  const adapter = accountAdapter(harness);
  if (!adapter) throw new HarnessAccountError(`${harness} does not support saved accounts.`);
  if (accountId) {
    const row = await loadRow(accountId);
    if (!row || row.harness !== adapter.harness) {
      throw new HarnessAccountError('That account does not belong to this harness.');
    }
  }
  await saveSelection(adapter.harness, accountId);
  await forgetProbe(adapter.harness);
  return state();
}

export async function renameHarnessAccount(
  accountId: string,
  label: string,
): Promise<HarnessAccountsState> {
  const row = await loadRow(accountId);
  if (!row) throw new HarnessAccountError('That account no longer exists.');
  const name = label.trim().slice(0, 80);
  if (!name) throw new HarnessAccountError('An account name cannot be empty.');
  const db = await getDb();
  await db.run('UPDATE harness_accounts SET label = ?, updated_at = ? WHERE id = ?', [
    name,
    Date.now(),
    row.id,
  ]);
  return state();
}

export async function verifyHarnessAccount(
  accountId: string,
): Promise<HarnessAccountsState & { signedIn: boolean; detail: string }> {
  const row = await loadRow(accountId);
  if (!row) throw new HarnessAccountError('That account no longer exists.');
  const read = await readAccountIdentity(row.harness, row.home_path);
  const db = await getDb();
  await db.run(
    `UPDATE harness_accounts
        SET identity = ?, auth_kind = ?, verified_at = ?, updated_at = ?
      WHERE id = ?`,
    [JSON.stringify(read.identity), read.authKind, Date.now(), Date.now(), row.id],
  );
  await forgetProbe(row.harness);
  return { ...(await state()), signedIn: read.signedIn, detail: read.detail };
}

export async function removeHarnessAccount(accountId: string): Promise<HarnessAccountsState> {
  const row = await loadRow(accountId);
  if (!row) throw new HarnessAccountError('That account no longer exists.');
  const home = homeFor(row.id);
  try {
    await assertHomeOwned(row);
    await rm(home, { recursive: true, force: true });
  } catch (error) {
    // A home already gone is a successful removal; a foreign home is not.
    if (!(error instanceof AccountHomeGoneError)) throw error;
  }
  const db = await getDb();
  await db.run('DELETE FROM harness_accounts WHERE id = ?', [row.id]);
  await db.run('DELETE FROM harness_account_selection WHERE harness = ? AND account_id = ?', [
    row.harness,
    row.id,
  ]);
  await forgetProbe(row.harness);
  return state();
}
