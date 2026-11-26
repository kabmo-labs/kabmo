/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Saved-account operations for the harness settings card.
 *
 * Kept out of `root.ts` because an account write names no probe and answers a
 * different shape; burying it among the probe branches made a request without
 * `probe` fail before it reached the handler.
 */

import { json } from '@kabmo-labs/kabmo-http';
import {
  createHarnessAccount,
  removeHarnessAccount,
  renameHarnessAccount,
  selectHarnessAccount,
  verifyHarnessAccount,
} from '@kabmo-labs/kabmo-harness/account-store';
import {
  accountLoginStatus,
  cancelAccountLogin,
  startAccountLogin,
  submitAccountLoginInput,
} from '@kabmo-labs/kabmo-harness/account-store/account-login.server';

type AccountBody = {
  op?: unknown;
  harness?: unknown;
  accountId?: unknown;
  label?: unknown;
  text?: unknown;
};

function failure(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Could not update this account';
  return json({ error: message }, { status: 400 });
}

export async function harnessAccountAction(raw: unknown): Promise<Response> {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as AccountBody;
  const op = typeof body.op === 'string' ? body.op : '';
  try {
    if (op === 'create') {
      const harness = typeof body.harness === 'string' ? body.harness : '';
      if (!harness) return json({ error: 'harness is required' }, { status: 400 });
      const label = typeof body.label === 'string' ? body.label : undefined;
      return json(await createHarnessAccount(harness, label));
    }
    if (op === 'select') {
      const harness = typeof body.harness === 'string' ? body.harness : '';
      const accountId = body.accountId === null
        ? null
        : typeof body.accountId === 'string' ? body.accountId : undefined;
      if (!harness || accountId === undefined) {
        return json({ error: 'harness and accountId are required' }, { status: 400 });
      }
      return json(await selectHarnessAccount(harness, accountId));
    }
    if (op === 'rename') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      const label = typeof body.label === 'string' ? body.label : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      return json(await renameHarnessAccount(accountId, label));
    }
    if (op === 'verify') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      return json(await verifyHarnessAccount(accountId));
    }
    if (op === 'login-start') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      return json({ login: await startAccountLogin(accountId) });
    }
    if (op === 'login-status') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      return json({ login: accountLoginStatus(accountId) });
    }
    if (op === 'login-input') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      const text = typeof body.text === 'string' ? body.text : '';
      if (!accountId || !text.trim()) {
        return json({ error: 'accountId and text are required' }, { status: 400 });
      }
      return json({ login: submitAccountLoginInput(accountId, text.trim()) });
    }
    if (op === 'login-cancel') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      cancelAccountLogin(accountId);
      return json({ login: null });
    }
    if (op === 'remove') {
      const accountId = typeof body.accountId === 'string' ? body.accountId : '';
      if (!accountId) return json({ error: 'accountId is required' }, { status: 400 });
      return json(await removeHarnessAccount(accountId));
    }
    return json({ error: `Unknown account operation: ${op || '(empty)'}` }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
