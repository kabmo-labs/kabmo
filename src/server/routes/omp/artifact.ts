/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET /api/omp/artifact?sessionId=&id=&kind=` — the full text of a tool result
 * omp spilled to disk instead of keeping inline.
 *
 * The transcript keeps only a truncated body plus
 * `details.meta.limits.columnTruncated.artifactId`; the rest lives in a file
 * beside the session (`<sessionDir>/<sessionId>/<id>.<kind>.log`). The reader
 * owns every path guard — a numeric id, a known kind, a resolved path inside
 * the session directory — so this route only turns its answer into a response.
 *
 * `no-store`, like the blob route: a session copied between machines can leave
 * an artifact missing, and a 404 that later becomes available must not stay
 * broken for the life of the tab.
 */

import { json, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { errorResponse } from '@/server/lib/route-adapter';
import { readArtifact } from '@/server/lib/omp/session/artifacts.server';

export async function loader({ request }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const sessionId = params.get('sessionId');
  const id = params.get('id');
  if (!sessionId || !id) {
    return json({ error: 'Missing sessionId or id' }, { status: 400 });
  }

  try {
    const artifact = await readArtifact(sessionId, id, params.get('kind') ?? undefined);
    if (!artifact) {
      return json({ error: 'Artifact not found' }, { status: 404 });
    }
    return json(artifact, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return errorResponse(error);
  }
}
