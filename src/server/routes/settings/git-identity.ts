/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET/POST /api/settings/git-identity` — the global commit identity.
 *
 * A settings route rather than a git action: the write is `git config --global`,
 * which has no repository operand. The saved identities are read from Kabmo's
 * settings blob; the applied one is written to the user's global git config.
 */

import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import {
  applyGitIdentity,
  readGitIdentity,
  readGitIdentitySettings,
} from '@/server/lib/fs/git-identity.server';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  return json({ success: true, ...(await readGitIdentity()) });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const body = await request.json().catch(() => null) as { identityId?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const identityId = typeof body.identityId === 'string' ? body.identityId.trim() : '';
  if (!identityId) {
    return json({ success: true, ...(await applyGitIdentity(null)) });
  }

  const { identities } = await readGitIdentitySettings();
  const identity = identities.find((entry) => entry.id === identityId);
  if (!identity) {
    return json({ error: 'That identity no longer exists.' }, { status: 400 });
  }
  return json({ success: true, ...(await applyGitIdentity(identity)) });
}
