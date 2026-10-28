/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Client calls for removing a provider's stored credential.
 *
 * `disable`/`disconnect` write `disabledProviders` in `config.yml` and leave the
 * OAuth token or API key on disk; these call omp's `get_logout_accounts` and
 * `logout` through `POST /api/settings/providers/logout`, which is the only
 * operation that actually deletes it.
 */

export interface LogoutAccount {
  credentialId: number;
  label: string;
  /** True for the credential a request would currently use. */
  active?: boolean;
}

export interface LogoutAccountsResult {
  accounts: LogoutAccount[];
  /** Set when the read was refused; `accounts` is then empty for that reason. */
  error?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

export async function fetchLogoutAccounts(providerId: string): Promise<LogoutAccountsResult> {
  try {
    const res = await fetch('/api/settings/providers/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
    });
    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) {
      const error = body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
      return { accounts: [], error };
    }
    const raw = body?.accounts;
    if (!Array.isArray(raw)) return { accounts: [] };
    const accounts: LogoutAccount[] = [];
    for (const entry of raw) {
      const record = asRecord(entry);
      if (!record || typeof record.credentialId !== 'number') continue;
      accounts.push({
        credentialId: record.credentialId,
        label: typeof record.label === 'string' ? record.label : `credential ${record.credentialId}`,
        ...(record.active === true ? { active: true } : {}),
      });
    }
    return { accounts };
  } catch (e) {
    return { accounts: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export interface LogoutResult {
  /** Auth that still applies after the removal, when omp reports any. */
  remainingSource?: string;
  error?: string;
}

export async function logoutProvider(providerId: string, credentialId: number): Promise<LogoutResult> {
  try {
    const res = await fetch('/api/settings/providers/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, credentialId }),
    });
    const body = asRecord(await res.json().catch(() => null));
    if (!res.ok) {
      return { error: body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
    }
    return {
      ...(body && typeof body.remainingSource === 'string' ? { remainingSource: body.remainingSource } : {}),
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
