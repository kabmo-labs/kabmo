import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { createHarnessAccount, verifyHarnessAccount } from '@/server/lib/harness/accounts.server';
import {
  accountLoginStatus,
  cancelAccountLogin,
  cleanLoginText,
  extractLoginUrl,
  startAccountLogin,
  submitAccountLoginInput,
} from '@/server/lib/harness/account-login.server';

const roots: string[] = [];
const savedDataDir = Bun.env.KABMO_DATA_DIR;

// A real PTY and a real child: output and exit are kernel events with no
// fake-timer equivalent, so this is one of the rare integration waits.
async function waitFor<T>(read: () => T | null, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await Bun.sleep(30);
  }
  throw new Error('timed out waiting for the login job');
}

beforeEach(async () => {
  await isolateDb();
  const dir = mkdtempSync(join(tmpdir(), 'kabmo-login-'));
  roots.push(dir);
  Bun.env.KABMO_DATA_DIR = dir;
});

afterEach(async () => {
  await releaseDb();
  if (savedDataDir === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = savedDataDir;
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'none' })}.${part(claims)}.sig`;
}

async function runFakeLogin(
  harness: 'codex' | 'claude' | 'antigravity',
  body: string[],
) {
  const state = await createHarnessAccount(harness, 'Work');
  const account = state.accounts.find((entry) => entry.harness === harness)!;
  const script = join(account.homePath, 'fake-login.sh');
  writeFileSync(script, ['#!/bin/sh', ...body].join('\n'));
  await startAccountLogin(account.id, { command: ['/bin/sh', script] });
  await waitFor(() => (accountLoginStatus(account.id)?.url ? true : null));
  submitAccountLoginInput(account.id, 'SECRET-CODE');
  const finished = await waitFor(() => {
    const view = accountLoginStatus(account.id);
    return view && view.phase !== 'running' ? view : null;
  }, 5_000);
  expect(finished.phase).toBe('done');
  const verified = await verifyHarnessAccount(account.id);
  cancelAccountLogin(account.id);
  return verified;
}

describe('spawned account login', () => {
  test('ANSI is stripped and an OAuth link is preferred over the local server', () => {
    const raw = '\u001b[32mStarting local login server on http://localhost:1455.\u001b[0m\n'
      + 'Open https://auth.openai.com/authorize?client_id=abc&scope=openid.';
    expect(cleanLoginText(raw)).not.toContain('\u001b');
    expect(extractLoginUrl(raw)).toBe('https://auth.openai.com/authorize?client_id=abc&scope=openid');
  });

  test('a PTY command, its URL, a code, and the resulting auth are one job', async () => {
    const state = await createHarnessAccount('codex', 'Work');
    const account = state.accounts[0]!;
    const script = join(account.homePath, 'fake-login.sh');
    writeFileSync(
      script,
      [
        '#!/bin/sh',
        'printf "Open https://example.com/oauth/authorize?code=1\\n"',
        'printf "Enter code: "',
        'read code',
        'printf \'{"tokens":{"access_token":"fake","account_id":"acct-1"}}\' > "$CODEX_HOME/auth.json"',
        'echo "done $code"',
      ].join('\n'),
    );

    const started = await startAccountLogin(account.id, { command: ['/bin/sh', script] });
    expect(started.phase).toBe('running');
    const withUrl = await waitFor(() => {
      const view = accountLoginStatus(account.id);
      return view?.url ? view : null;
    });
    expect(withUrl.url).toBe('https://example.com/oauth/authorize?code=1');

    submitAccountLoginInput(account.id, 'SECRET-CODE');
    const finished = await waitFor(() => {
      const view = accountLoginStatus(account.id);
      return view && view.phase !== 'running' ? view : null;
    }, 5_000);
    expect(finished.phase).toBe('done');
    expect(finished.lines.join('\n')).toContain('done SECRET-CODE');
    cancelAccountLogin(account.id);
    expect(accountLoginStatus(account.id)).toBeNull();
  });

  test('Claude writes its config dir and the spawned job verifies the email', async () => {
    const verified = await runFakeLogin('claude', [
      'printf "Open https://claude.ai/oauth/authorize?code=1\\n"',
      'printf "Code: "',
      'read code',
      'printf \'{"oauthAccount":{"emailAddress":"claude@example.com"}}\' > "$CLAUDE_CONFIG_DIR/.claude.json"',
      'echo "done $code"',
    ]);
    const row = verified.accounts.find((entry) => entry.harness === 'claude');
    expect(verified.signedIn).toBe(true);
    expect(row?.identity.email).toBe('claude@example.com');
  });

  test('Antigravity writes its GEMINI_HOME token and verifies the Google subject', async () => {
    const token = jwt({
      iss: 'https://accounts.google.com',
      sub: 'google-1',
      email: 'agy@example.com',
      email_verified: true,
    });
    const verified = await runFakeLogin('antigravity', [
      'printf "Open https://accounts.google.com/o/oauth2/auth?code=1\\n"',
      'printf "Code: "',
      'read code',
      'mkdir -p "$GEMINI_HOME/antigravity-acp"',
      `printf '{"token":{"access_token":"fake"},"id_token":"${token}"}' > "$GEMINI_HOME/antigravity-acp/acp_token.json"`,
      'echo "done $code"',
    ]);
    const row = verified.accounts.find((entry) => entry.harness === 'antigravity');
    expect(verified.signedIn).toBe(true);
    expect(row?.identity.email).toBe('agy@example.com');
    expect(row?.identity.subject).toBe('google-1');
  });
});
