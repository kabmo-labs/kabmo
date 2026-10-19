import { Elysia } from 'elysia';
import { getDb } from '@/server/db.server';
import { isAuthEnabled, isAuthenticatedRequest } from '@/server/lib/auth/guard';
import { tryServeStatic } from '@/server/plugins/static';
import { renderShell, SHELL_MARKER } from '@/server/plugins/shell.server';
import {
  DEV_ASSETS_ENABLED,
  devAssetUpstreamPath,
  rewriteDevAssetUrls,
  serveDevAsset,
} from '@/server/lib/assets/dev-assets.server';
import { listenerFetchOptions, listenerUrl } from '@/server/lib/lifecycle/listener';
import { FONT_STYLESHEET_ROUTE } from '@/server/lib/assets/font-css.server';
import { readSettingsBlob } from '@/shared/lib/settings/keys';
import { resolveTheme } from '@/shared/lib/theme/catalog';
import { windowChromeColor } from '@/shared/lib/theme/chrome';
import { THEME_STYLE_ELEMENT_ID, themeStyleSheet } from '@/shared/lib/theme/css';

/** HTML-escape a string for interpolation into the failure page's `<pre>`. */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Actionable message instead of a bare 500 when the shell cannot be rendered.
 *
 * The shell is a Bun HTML route now, not a file on disk, so "not found" is no
 * longer the failure mode — a bundle error is, and Bun renders its own error
 * page for that, with the file and line locked inside a payload only the
 * browser can decode. `plugins/shell.server.ts` rebuilds the entrypoint to get
 * those facts in readable form and passes them here as the reason, so this page
 * names the edit that broke the bundle rather than the status it produced.
 */
function shellUnavailableResponse(reason: string): Response {
  // Escaped, not interpolated raw: the reason carries the failed build's own
  // source lines, which are arbitrary code — a `<` in one would otherwise
  // truncate the page at the first tag.
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Kabmo</title>
<body style="font:14px/1.6 ui-monospace,monospace;padding:2rem">
<h1 style="font-size:1.1rem">Shell not available</h1>
<p>The server could not render its HTML shell.</p>
<pre style="background:#f4f1ea;padding:1rem;border-radius:6px">${escapeHtmlText(reason)}</pre>
</body>`,
    { status: 503, headers: HTML_HEADERS },
  );
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const db = await getDb();
    const rows = await db.all<{ key: string; value: string }>('SELECT * FROM app_settings');
    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }
    return settings;
  } catch {
    return {};
  }
}

const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

/**
 * The HTML shell is generated per request, so its cacheability is declared
 * rather than left to the browser's heuristics.
 *
 * It is not a static file: the theme and the bootstrap settings are injected on
 * every request, and its only link to the bundle is a content hash inside the
 * markup. A copy that outlives its build does not merely go stale — it points at
 * an asset hash the build no longer emits, leaving the page running previous
 * code with nothing in the response to signal it.
 *
 * Chrome does not currently cache it: the response carries no `Cache-Control`,
 * `Last-Modified` or `ETag`, so there is no freshness to heuristically derive
 * and every navigation re-fetches (measured: a second load of the shell reported
 * the full 41 KB `transferSize`). That is the behaviour this header makes
 * explicit — the day a validator is added for the template, heuristic caching
 * would start and nothing else here would prevent it.
 *
 * `no-store` rather than `no-cache`: with no validator there is nothing to
 * revalidate against, so a stored copy is never usable.
 */
const SHELL_CACHE = 'no-store';

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': SHELL_CACHE,
  // The shell is served to anyone — it has to be, since it renders the login
  // screen — so a crawler that finds a password-protected instance would index
  // its title and structure. `/robots.txt` states the intent; this header is
  // what actually enforces it, because robots.txt is advisory and only read by
  // crawlers that choose to.
  'x-robots-tag': 'noindex, nofollow',
} as const;

/** `/robots.txt` — the explicit half of the no-index rule above. */
const ROBOTS_TXT = 'User-agent: *\nDisallow: /\n';

export const ssrRoutes = new Elysia({ name: 'ssr' }).get('*', async ({ request }) => {
  const pathname = new URL(request.url).pathname;

  if (pathname === '/robots.txt') {
    return new Response(ROBOTS_TXT, {
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' },
    });
  }

  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // The dev asset proxy, before the static lookup: its prefix is this server's
  // own, and Bun's table never sees it. See `lib/assets/dev-assets.server`.
  if (DEV_ASSETS_ENABLED && devAssetUpstreamPath(pathname)) {
    const base = listenerUrl();
    if (base) {
      // The fetch options ride along for the same reason `renderShell` needs
      // them: under `--tls` this is an HTTPS request to the server's own
      // self-signed listener.
      const proxied = await serveDevAsset(request, pathname, base, listenerFetchOptions());
      if (proxied) return proxied;
    }
  }

  const asset = await tryServeStatic(pathname, request);
  if (asset) return asset;

  // An unauthenticated visitor still gets the shell — it IS the login screen —
  // but not the settings map. `appSettings` carries the provider registry, the
  // theme and every stored preference, and publishing it to whoever can reach
  // the port would hand out exactly what the password protects. The client
  // answers "is auth required" from `/api/auth/state` and renders the login
  // screen without it.
  const authenticated = isAuthenticatedRequest(request);
  const settings = authenticated ? await readSettings() : {};
  // Both blobs, legacy beneath: an install that predates the rename still has
  // its theme in the old row, and the SSR shell is what paints the first frame.
  const settingsBlob = readSettingsBlob(settings) as { theme?: string };
  // Resolved through the catalog: an id this build no longer ships (a
  // downgrade, the retired `noir` alias) renders the default palette instead of
  // an unstyled page.
  const theme = resolveTheme(settingsBlob.theme);
  const initialIsMobile = MOBILE_UA.test(request.headers.get('user-agent') ?? '');

  const rendered = await renderShell();
  if (!rendered.ok) return shellUnavailableResponse(rendered.reason);

  // `production` is the same predicate the dev-asset proxy runs on
  // (`NODE_ENV !== 'production'`), so the client's dev-only chrome and the
  // server's dev-only asset route can never disagree about which build this is.
  // `authEnabled` travels beside `authenticated` because they answer different
  // questions: "this browser has a session" versus "there is a session to have".
  // A Kabmo running open answers `authenticated: true` for every visitor, so
  // the navbar cannot use it to decide whether a sign-out control applies.
  const bootstrap = JSON.stringify({ initialIsMobile, authenticated, authEnabled: isAuthEnabled(), production: !DEV_ASSETS_ENABLED, appSettings: settings }).replace(/</g, '\\u003c');
  // The template's own `<meta name="theme-color">` is REWRITTEN, not joined by
  // a second tag: with both present Chrome reads the first one, so an appended
  // tag would leave a dark theme painting light browser chrome.
  const themeStyle = `<style id="${THEME_STYLE_ELEMENT_ID}">${themeStyleSheet()}</style>`;
  // The chrome color has to match the surface at the TOP of the window, which
  // is per-layout (`shared/lib/theme/chrome.ts`); this request already knows the
  // two facts behind it. The login screen is the shell too, and paints canvas.
  const chrome = windowChromeColor(theme, { isMobile: initialIsMobile, authRequired: !authenticated });
  // The font faces are a stylesheet the bundler cannot carry: Bun resolves every
  // local `url()` in CSS, so a bundled face is either base64 or an absolute
  // filesystem path. `lib/bundler/css.ts` strips the blocks out of the bundle
  // and `lib/assets/font-css.server.ts` re-declares them on the route below,
  // which is why the link is injected here — a `<link href="/fonts.css">` in
  // index.html would be resolved by the HTML loader and fail the same way.
  const fontLink = `<link rel="stylesheet" href="${FONT_STYLESHEET_ROUTE}">`;

  // Bun's dev asset URLs move to this server's prefix so the proxy above can add
  // the caching headers Bun omits. Rewritten BEFORE the bootstrap is injected,
  // so a `/_bun/` string inside the settings payload is left alone.
  const shellHtml = DEV_ASSETS_ENABLED ? rewriteDevAssetUrls(rendered.html) : rendered.html;

  return new Response(
    shellHtml
      .replace('data-theme="paper"', `data-theme="${theme.id}"`)
      .replace('data-theme-variant="light"', `data-theme-variant="${theme.variant}"`)
      .replace('<meta name="theme-color" content="#faf8f3" />', `<meta name="theme-color" content="${chrome}" />`)
      .replace('<!--app-head-->', themeStyle + fontLink)
      .replace(SHELL_MARKER, `<script>window.__OMP_BOOTSTRAP__=${bootstrap}</script>`),
    { headers: HTML_HEADERS },
  );
});
