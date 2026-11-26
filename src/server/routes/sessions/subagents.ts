import { json } from '@kabmo-labs/kabmo-http';
import type { LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';
import { findSessionFileById } from '@kabmo-labs/kabmo-omp-session-locator';
import { extractSubagentHistory } from '@/server/lib/omp/subagent/history';
import { SUBAGENT_ID_MAX_LENGTH, SUBAGENT_ID_RE } from '@kabmo-labs/kabmo-omp-subagent/history-paths';
import { readSubagentTranscriptPage } from '@/server/lib/omp/subagent/history/transcript';

/**
 * GET /api/sessions/:sessionId/subagents — on-disk subagent roster recovered
 * from the parent session file's task toolResults. Works without a live RPC
 * process (old sessions recover after a reload); an unknown session or one
 * without task calls yields an empty list, never a 404.
 */
export async function listSubagents({ params }: LoaderFunctionArgs) {
  const sessionId = params.sessionId;
  if (!sessionId) {
    return json({ error: 'Missing session id' }, { status: 400 });
  }

  // In mock mode, return predefined sample subagents
  if (isMockMode()) {
    const { getMockSubagents } = await import('@/client/data/mock/subagents');
    return json({ subagents: getMockSubagents(sessionId) });
  }

  try {
    const sessionFile = await findSessionFileById(sessionId);
    if (!sessionFile) return json({ subagents: [] });
    return json({ subagents: await extractSubagentHistory(sessionFile) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/sessions/:sessionId/subagents/:subagentId?fromByte=N — paged
 * transcript of one on-disk subagent, read from the parent session's sibling
 * artifacts dir (`<session-dir>/<subagentId>.jsonl`). `{ page: null }` when
 * the agent has no transcript on disk (still running, older session, or the
 * subagent id is unknown).
 */
export async function readSubagentTranscript({ request, params }: LoaderFunctionArgs) {
  const { sessionId, subagentId } = params;
  if (!sessionId || !subagentId) {
    return json({ error: 'Missing session id or subagent id' }, { status: 400 });
  }
  // Bounds the value before it reaches the filesystem (the lib re-checks).
  if (!SUBAGENT_ID_RE.test(subagentId) || subagentId.length > SUBAGENT_ID_MAX_LENGTH) {
    return json({ error: 'Invalid subagent id', code: 'invalid_subagent_id' }, { status: 400 });
  }

  if (isMockMode()) {
    const { getMockSubagentTranscriptPage } = await import('@/client/data/mock/subagents');
    const page = getMockSubagentTranscriptPage(subagentId, sessionId);
    return json({ page });
  }

  try {
    const sessionFile = await findSessionFileById(sessionId);
    if (!sessionFile) return json({ page: null });

    // One history pass locates the entry (and proves a sibling transcript was
    // recorded); the page reader re-derives the confined child path.
    const entry = (await extractSubagentHistory(sessionFile)).find((candidate) => candidate.id === subagentId);
    if (!entry?.transcriptAvailable || !entry.sessionFile) return json({ page: null });

    const fromByteRaw = new URL(request.url).searchParams.get('fromByte');
    const parsed = fromByteRaw !== null ? Number(fromByteRaw) : null;
    const fromByte = parsed !== null && Number.isFinite(parsed) ? parsed : 0;

    return json({ page: await readSubagentTranscriptPage(sessionFile, subagentId, fromByte) });
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
