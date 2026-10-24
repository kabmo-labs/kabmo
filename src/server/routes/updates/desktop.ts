import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import { fetchShellRelease, type ShellRelease } from '@/server/lib/updates/shell-release';
import { isDesktopShellKind, type DesktopShellKind } from '@/shared/lib/updates/shell-ua';
import { parseShellArch, type ShellArch } from '@/shared/lib/updates/shell-arch';

/**
 * GET /api/updates/desktop?kind=macos|windows|linux[&arch=arm64|x64]
 *
 * ONE route with an explicit `kind`, unlike the mobile pair's two routes, and
 * the difference is deliberate. `?kind` here is REQUIRED and refused when it is
 * missing or names no desktop shell, so no absence can silently mean a platform:
 * the mobile pair's split exists precisely because a defaulted parameter would
 * have made "the newest shell" mean Android without anyone saying so.
 *
 * ## `arch` is what makes the offer installable
 *
 * Only an INSTALLED desktop shell asks for this — the page reports its own
 * version over the shell bridge (`__kabmoDesktop.shellVersion`), because a
 * desktop app carries no User-Agent token. Without `arch` the answer is the
 * RELEASE PAGE: every desktop artifact is per-architecture, and a console served
 * to another machine cannot guess which one this window runs on.
 *
 * WITH `arch` the answer is that machine's own installer, and `direct: true`
 * says so — which is what lets the sidebar offer an in-app update instead of a
 * link. The shell still verifies the bytes before installing them; this route
 * only decides WHICH file, never whether it is trusted.
 *
 * An `arch` that names nothing this product publishes is a REFUSAL rather than a
 * silent fallback: a caller that asked for a build we do not make should be told,
 * not handed the other architecture's installer.
 *
 * A failed probe is a valid answer (`url: null`), never a 500: the sidebar's job
 * is to omit a button it cannot back with a link.
 */
export async function loader({ request }: { request: Request }) {
  const params = new URL(request.url).searchParams;
  const kind = params.get('kind');
  if (!isDesktopShellKind(kind ?? '')) {
    return json(
      { error: 'kind must be one of macos, windows, linux' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const requested = params.get('arch');
  const arch: ShellArch | null = requested ? parseShellArch(requested) : null;
  if (requested && !arch) {
    return json(
      { error: 'arch must be one of arm64, x64' },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const release: ShellRelease | null = await fetchShellRelease(kind as DesktopShellKind, fetch, arch);
  return json(
    release ?? { url: null, latest: null, releaseUrl: null, direct: false },
    { headers: NO_STORE_HEADERS },
  );
}
