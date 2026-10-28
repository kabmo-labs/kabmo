/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * POST /api/fs/grant — open a file that lives outside every workspace.
 *
 * Dropping `~/Desktop/report.pdf` on the editor is a real gesture on a real
 * file, and the console used to answer "outside every workspace this console can
 * read": the tab the user asked for was refused for a reason that had nothing to
 * do with the file. This route is the one place that turns such a gesture into a
 * grant — it registers the file's own DIRECTORY (`lib/fs/external-roots.ts`
 * holds the rules and the bounds) and then answers the same scope payload
 * `/api/fs/scope` would have.
 *
 * It is a POST with a JSON body, and that is a security decision rather than a
 * style one:
 *
 * - a cross-origin page can fire a `no-cors` GET or POST at localhost without
 *   reading the answer, and a grant is a lasting change to what the console may
 *   read — so the same-origin check below is the gate;
 * - a JSON body means the browser sends a preflight for any cross-origin
 *   attempt, which the same-origin check then refuses.
 *
 * Only a FILE can grant: a dropped folder has no tab, and registering a
 * directory the user merely hovered over is not a gesture the console should
 * invent.
 */

import { json, type ActionFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse, methodNotAllowedResponse } from '@/server/lib/route-adapter';
import { isSameOriginRequest } from '@/server/lib/http/same-origin';
import { grantExternalRoot } from '@/server/lib/fs/external-roots';
import { pathFromReference, describeFileReference } from '@/server/routes/fs/scope';
import fs from 'fs';
import path from 'path';

export async function action({ request }: ActionFunctionArgs): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowedResponse();
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Cross-origin requests cannot open a file.' }, { status: 403 });
  }

  let body: { path?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ error: 'Expected a JSON body' }, { status: 400 });
  }

  const raw = typeof body.path === 'string' ? body.path.trim() : '';
  if (!raw) return json({ error: 'Missing path' }, { status: 400 });

  const reference = pathFromReference(raw);
  if (!reference) return json({ error: 'Malformed file URL' }, { status: 400 });
  if (!path.isAbsolute(reference)) {
    return json({ error: 'Expected an absolute path' }, { status: 400 });
  }

  const stat = await fs.promises.stat(reference).catch(() => null);
  if (!stat) return json({ error: 'File not found' }, { status: 404 });
  if (stat.isDirectory()) {
    return json({ error: 'That is a folder, not a file.' }, { status: 400 });
  }

  // The parent is what becomes readable: a grant names a directory, and the tab
  // needs a root to be `root` + relative path like every other tab.
  const granted = grantExternalRoot(path.dirname(reference));
  if (!granted) {
    return json({ error: 'That directory cannot be opened from here.' }, { status: 400 });
  }

  try {
    return await describeFileReference(reference);
  } catch (error) {
    return errorResponse(error);
  }
}
