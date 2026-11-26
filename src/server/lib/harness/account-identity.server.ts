/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read who a CLI home is signed in as, without starting the agent.
 *
 * The token files are the CLIs' own; nothing here writes them. A missing or
 * malformed file is reported as "not signed in yet", never as an empty email
 * that a caller could mistake for a verified account.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AccountHarness, HarnessAccountIdentity } from '@kabmo-labs/kabmo-harness-accounts';

export interface AccountIdentityResult {
  identity: HarnessAccountIdentity;
  authKind: string;
  signedIn: boolean;
  detail: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function jwtPayload(token: unknown): Record<string, unknown> | null {
  const raw = text(token);
  const parts = raw?.split('.');
  if (!parts || parts.length < 2) return null;
  try {
    return record(JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

async function jsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    return record(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return null;
  }
}

async function codexIdentity(home: string): Promise<AccountIdentityResult> {
  const path = join(home, 'auth.json');
  const auth = await jsonFile(path);
  if (!auth) {
    return {
      identity: {},
      authKind: 'unknown',
      signedIn: false,
      detail: 'No readable auth.json in this home yet.',
    };
  }
  const tokens = record(auth.tokens);
  const idToken = tokens?.id_token ?? tokens?.idToken;
  const payload = jwtPayload(idToken);
  const authClaims = record(payload?.['https://api.openai.com/auth']);
  const profileClaims = record(payload?.['https://api.openai.com/profile']);
  const email = text(payload?.email) ?? text(profileClaims?.email);
  const subject =
    text(authClaims?.chatgpt_account_id) ??
    text(payload?.chatgpt_account_id) ??
    text(tokens?.account_id) ??
    text(tokens?.accountId);
  const apiKey = text(auth.OPENAI_API_KEY) ?? text(auth.api_key);
  const signedIn = Boolean(idToken || tokens?.access_token || apiKey);
  return {
    identity: {
      ...(email ? { email } : {}),
      ...(subject ? { subject } : {}),
      ...(text(authClaims?.workspace_name)
        ? { organization: text(authClaims?.workspace_name) as string }
        : {}),
    },
    authKind: idToken || tokens?.access_token ? 'oauth' : apiKey ? 'api-key' : 'unknown',
    signedIn,
    detail: signedIn
      ? email
        ? `Signed in as ${email}.`
        : 'Signed in; this token carries no email.'
      : 'auth.json exists but holds no usable credential.',
  };
}

async function claudeIdentity(home: string): Promise<AccountIdentityResult> {
  const state = await jsonFile(join(home, '.claude.json'));
  const account = record(state?.oauthAccount);
  const email = text(account?.emailAddress);
  const organization = text(account?.organizationName);
  const credentials = await readFile(join(home, '.credentials.json')).then(() => true, () => false);
  // The state file is written by Claude on every profile sign-in; on macOS the
  // secret itself lives in the Keychain, keyed by this config directory.
  if (!email && !credentials) {
    return {
      identity: {},
      authKind: 'unknown',
      signedIn: false,
      detail: 'No Claude login in this config directory yet.',
    };
  }
  return {
    identity: {
      ...(email ? { email } : {}),
      ...(organization ? { organization } : {}),
    },
    authKind: 'oauth',
    signedIn: true,
    detail: email ? `Signed in as ${email}.` : 'Signed in; no email in the state file.',
  };
}

async function antigravityIdentity(home: string): Promise<AccountIdentityResult> {
  const path = join(home, 'antigravity-acp', 'acp_token.json');
  const saved = await jsonFile(path);
  if (!saved) {
    return {
      identity: {},
      authKind: 'unknown',
      signedIn: false,
      detail: 'No agy token in this GEMINI_HOME yet.',
    };
  }
  const token = record(saved.token);
  const idToken = saved.id_token ?? token?.id_token;
  const payload = jwtPayload(idToken);
  const email = payload?.email_verified === true ? text(payload.email) : undefined;
  const subject = text(payload?.sub);
  const accessToken = text(token?.access_token) ?? text(saved.access_token);
  const method = text(saved.auth_method) ?? '';
  return {
    identity: {
      ...(email ? { email } : {}),
      ...(subject ? { subject } : {}),
    },
    authKind: method.includes('api-key') ? 'api-key' : accessToken ? 'oauth' : 'unknown',
    signedIn: Boolean(accessToken),
    detail: accessToken
      ? email
        ? `Signed in as ${email}.`
        : 'Signed in; this token carries no verified email.'
      : 'The token file exists but holds no access token.',
  };
}

export async function readAccountIdentity(
  harness: AccountHarness,
  home: string,
): Promise<AccountIdentityResult> {
  if (harness === 'codex') return codexIdentity(home);
  if (harness === 'claude') return claudeIdentity(home);
  return antigravityIdentity(home);
}
