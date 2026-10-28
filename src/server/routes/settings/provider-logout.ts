/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Removing a provider's STORED CREDENTIAL — the operation the settings pane
 * used to promise and not perform.
 *
 * omp splits two things that both read as "turn this provider off":
 *
 *   - `disabledProviders` in `config.yml` (what Kabmo's `disconnect` and
 *     `disable` both wrote) hides the provider's models from the picker. The
 *     OAuth token or API key STAYS on disk.
 *   - `logout` (with the account named by `get_logout_accounts`) actually
 *     deletes the credential.
 *
 * Two buttons that both hid the provider while leaving the secret behind is a
 * security-relevant lie on a settings screen, so the credential operation is
 * wired to its own verb rather than folded into the disable toggle.
 *
 * Both commands run on the shared utility RPC child — no session is involved,
 * and the account list has to be read before it can be acted on because omp
 * addresses a credential by `(providerId, credentialId)`.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { isMockMode } from '@/server/mock.server';
import { runUtilityCommand } from '@/server/lib/omp/rpc/utility';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

/** One credential omp could remove for a provider. */
export interface LogoutAccount {
  credentialId: number;
  label: string;
  /** True for the credential a request would currently use. */
  active?: boolean;
}

/** omp's `LogoutAccount` shape, narrowed defensively — the reply is untyped. */
function parseAccounts(value: unknown): LogoutAccount[] {
  if (!value || typeof value !== 'object' || !('accounts' in value)) return [];
  const raw = value.accounts;
  if (!Array.isArray(raw)) return [];
  const accounts: LogoutAccount[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const id = 'credentialId' in entry ? entry.credentialId : ('id' in entry ? entry.id : undefined);
    if (typeof id !== 'number') continue;
    const email = 'email' in entry && typeof entry.email === 'string' ? entry.email : undefined;
    const label = 'label' in entry && typeof entry.label === 'string' ? entry.label : undefined;
    accounts.push({
      credentialId: id,
      label: label ?? email ?? `credential ${id}`,
      ...('active' in entry && entry.active === true ? { active: true } : {}),
    });
  }
  return accounts;
}

/**
 * POST /api/settings/providers/logout
 * Body: `{ providerId }` → the removable accounts, or
 *      `{ providerId, credentialId }` → remove that one.
 */
export async function logoutAction({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, { status: 405 });

  const body = (await request.json().catch(() => null)) as
    { providerId?: unknown; credentialId?: unknown } | null;
  const providerId = typeof body?.providerId === 'string' ? body.providerId.trim() : '';
  if (!providerId) return json({ error: 'providerId is required' }, { status: 400 });

  if (isMockMode()) {
    return json({ success: true, accounts: [], isMock: true });
  }

  const credentialId = typeof body?.credentialId === 'number' ? body.credentialId : null;

  try {
    if (credentialId === null) {
      const result = await runUtilityCommand<unknown>(
        { type: 'get_logout_accounts', providerId },
        15_000,
      );
      return json({ success: true, accounts: parseAccounts(result), isMock: false });
    }

    const result = await runUtilityCommand<{ remainingSource?: unknown }>(
      { type: 'logout', providerId, credentialId },
      30_000,
    );
    // The credential is gone, so every cached provider/model list is stale.
    invalidateModelsCaches();
    const remainingSource = typeof result?.remainingSource === 'string' ? result.remainingSource : undefined;
    return json({ success: true, remainingSource, isMock: false });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
