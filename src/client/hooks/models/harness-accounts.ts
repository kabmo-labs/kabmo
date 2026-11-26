/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saved-account writes, folded back from the server's answer.
 *
 * The server returns the WHOLE account state after every mutation, because a
 * selection change can also clear a stale row. Patching the local list would
 * let the panel and the next spawn disagree about which home is active.
 */

import type { HarnessAccountView } from '@kabmo-labs/kabmo-harness-accounts';
import { emit, store } from '@/client/hooks/models/harness-catalog';

export interface AccountMutationResult {
  error: string | null;
  createdId?: string;
  signedIn?: boolean;
  detail?: string;
}

interface AccountResponse {
  accounts?: HarnessAccountView[];
  selected?: Record<string, string | null>;
  createdId?: string;
  signedIn?: boolean;
  detail?: string;
  error?: string;
}

async function mutate(body: Record<string, unknown>): Promise<AccountMutationResult> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: body }),
    });
    const payload = (await response.json()) as AccountResponse;
    if (!response.ok || !payload.accounts) {
      return { error: payload.error ?? `Account update failed (HTTP ${response.status})` };
    }
    const probeChanged = ['create', 'select', 'remove', 'verify'].includes(String(body.op));
    const affected = new Set<string>();
    const prior = typeof body.accountId === 'string'
      ? store.accounts.find((account) => account.id === body.accountId)?.harness
      : undefined;
    if (prior) affected.add(prior);
    if (typeof body.harness === 'string') affected.add(body.harness);
    emit({
      accounts: payload.accounts,
      accountSelection: payload.selected ?? {},
      // The server forgot this harness's probe: the old answer described the
      // previous login. Clearing it here is what makes the card say "not probed"
      // instead of keeping a ready chip beside "Not signed in".
      harnesses: !probeChanged ? store.harnesses : store.harnesses.map((entry) => (
        affected.has(entry.id) ? { ...entry, probe: null } : entry
      )),
    });
    return {
      error: null,
      ...(payload.createdId ? { createdId: payload.createdId } : {}),
      ...(typeof payload.signedIn === 'boolean' ? { signedIn: payload.signedIn } : {}),
      ...(payload.detail ? { detail: payload.detail } : {}),
    };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'Account update failed' };
  }
}

export function createHarnessAccount(
  harness: string,
  label: string,
): Promise<AccountMutationResult> {
  return mutate({ op: 'create', harness, label });
}

export function selectHarnessAccount(
  harness: string,
  accountId: string | null,
): Promise<AccountMutationResult> {
  return mutate({ op: 'select', harness, accountId });
}

export function renameHarnessAccount(accountId: string, label: string): Promise<AccountMutationResult> {
  return mutate({ op: 'rename', accountId, label });
}

export function removeHarnessAccount(accountId: string): Promise<AccountMutationResult> {
  return mutate({ op: 'remove', accountId });
}

export function verifyHarnessAccount(accountId: string): Promise<AccountMutationResult> {
  return mutate({ op: 'verify', accountId });
}

export type AccountLoginPhase = 'running' | 'done' | 'error' | 'cancelled';

export interface AccountLoginView {
  phase: AccountLoginPhase;
  url: string | null;
  lines: string[];
  error: string | null;
}

export interface AccountLoginResult {
  error: string | null;
  login: AccountLoginView | null;
}

async function loginOp(body: Record<string, unknown>): Promise<AccountLoginResult> {
  try {
    const response = await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: body }),
    });
    const payload = (await response.json()) as { login?: AccountLoginView | null; error?: string };
    if (!response.ok) {
      return { error: payload.error ?? `Sign-in failed (HTTP ${response.status})`, login: null };
    }
    return { error: null, login: payload.login ?? null };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : 'Sign-in failed', login: null };
  }
}

export function startAccountLogin(accountId: string): Promise<AccountLoginResult> {
  return loginOp({ op: 'login-start', accountId });
}

export function accountLoginStatus(accountId: string): Promise<AccountLoginResult> {
  return loginOp({ op: 'login-status', accountId });
}

export function submitAccountLoginInput(accountId: string, text: string): Promise<AccountLoginResult> {
  return loginOp({ op: 'login-input', accountId, text });
}

export function cancelAccountLogin(accountId: string): Promise<AccountLoginResult> {
  return loginOp({ op: 'login-cancel', accountId });
}
