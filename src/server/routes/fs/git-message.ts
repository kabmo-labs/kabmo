/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `POST /api/fs/git-message` — write a commit message from the staged change
 * set, through the harness the user runs.
 *
 * A separate route from `/api/fs/git` on purpose: that module's `action` is a
 * dispatch table of GIT mutations, and this is a model call. Keeping it out of
 * the table means a generation failure cannot be mistaken for a failed commit,
 * and the route can answer its own status codes (409 for "nothing staged",
 * 504 for a timeout) without teaching the git action envelope about them.
 *
 * The body is JSON, not form data: the request carries no file operand, and the
 * only fields are the scope (`root`, `repo`), the optional `sessionId` that
 * decides the `auto` harness, and the amend flag.
 */

import path from 'path';
import { json, type ActionFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { getDefaultFsRoot, resolveRoot } from '@kabmo-labs/kabmo-workspace-root/root';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { generateCommitMessage } from '@/server/lib/fs/git-commit-message.server';
import { readCommitMessageSettings } from '@/server/lib/fs/git-commit-settings.server';

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const rootDir = await resolveRoot(
    typeof body.root === 'string' ? body.root : null,
    await getDefaultFsRoot(isMockMode()),
  );
  const repo = typeof body.repo === 'string' && body.repo.trim() ? body.repo.trim() : '.';
  const targetDir = repo === '.' ? rootDir : path.join(rootDir, repo);
  if (targetDir !== rootDir && !targetDir.startsWith(rootDir + path.sep)) {
    return json({ error: 'Invalid repo path' }, { status: 403 });
  }

  const sessionId = typeof body.sessionId === 'string' && body.sessionId.trim()
    ? body.sessionId.trim()
    : null;
  const amend = body.amend === true || body.amend === '1';
  const settings = await readCommitMessageSettings();

  const result = await generateCommitMessage({ targetDir, sessionId, amend, settings });
  if (!result.ok) {
    return json({ error: result.error, code: result.code }, { status: result.status });
  }
  return json({ success: true, message: result.message, target: result.target });
}
