import { json, NO_STORE_HEADERS, type LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { buildActiveReleaseNotes } from '@/server/lib/updates/active-notes';
import type { UpdateTarget } from '@/shared/types/updates';

/**
 * GET /api/updates/notes?target=kabmo|omp — the changelog section for the
 * version this machine is RUNNING.
 *
 * `target` is the only input, and it selects a source, never a version: both
 * versions are read server-side from the install itself, so this endpoint
 * cannot be asked about a release the copy does not have. A payload always
 * carries renderable fields — a failure is an `error`, not a 500 — because the
 * dialog opens from a button inside About.
 */
function readTarget(value: string | null): UpdateTarget | null {
  return value === 'kabmo' || value === 'omp' ? value : null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const target = readTarget(new URL(request.url).searchParams.get('target'));
  if (!target) {
    return json({ error: 'Unknown update target' }, { status: 400, headers: NO_STORE_HEADERS });
  }

  try {
    return json(await buildActiveReleaseNotes(target), { headers: NO_STORE_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to read release notes';
    return json(
      { target, version: null, note: null, changelogUrl: '', error: message },
      { headers: NO_STORE_HEADERS },
    );
  }
}