import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { fetchShellRelease, type ShellRelease } from '@/server/lib/updates/shell-release';
import { isDesktopShellKind, type DesktopShellKind } from '@/shared/lib/updates/shell-ua';

/**
 * GET /api/updates/desktop?kind=macos|windows|linux — the newest desktop shell.
 *
 * ONE route with an explicit `kind`, unlike the mobile pair's two routes, and
 * the difference is deliberate. `?kind` here is REQUIRED and refused when it is
 * missing or names no desktop shell, so no absence can silently mean a platform:
 * the mobile pair's split exists precisely because a defaulted parameter would
 * have made "the newest shell" mean Android without anyone saying so.
 *
 * Only an INSTALLED desktop shell asks for this — the page reports its own
 * version over the shell bridge (`__kabmoDesktop.shellVersion`), because a
 * desktop app carries no User-Agent token. The `url` it answers with is the
 * RELEASE PAGE rather than a file: every desktop artifact is per-architecture,
 * and the server cannot know which architecture the window is running on.
 *
 * A failed probe is a valid answer (`url: null`), never a 500: the sidebar's job
 * is to omit a button it cannot back with a link.
 */
export async function loader({ request }: { request: Request }) {
  const kind = new URL(request.url).searchParams.get('kind');
  if (!isDesktopShellKind(kind ?? '')) {
    return json(
      { error: 'kind must be one of macos, windows, linux' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const release: ShellRelease | null = await fetchShellRelease(kind as DesktopShellKind);
  return json(
    release ?? { url: null, latest: null, releaseUrl: null },
    { headers: NO_STORE_HEADERS },
  );
}
