/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The HTML shell, rendered by Bun's own HTML pipeline.
 *
 * The shell used to be a file the bundler wrote and the server read back
 * (`dist/client/index.html`). It is now a route Bun bundles and renders: the
 * `index.html` import carries a manifest of hashed assets, and fetching the
 * shell route returns that markup with the correct script and stylesheet tags
 * for the current build — which is also what keeps the dev HMR client injected.
 *
 * The round-trip through the local listener is deliberate. Bun renders an HTML
 * route only when serving it, and there is no API to render an `HTMLBundle` in
 * process: `new Response(bundle)` yields the string "[object HTMLBundle]" and
 * `app.handle('/_shell')` answers 404, because the route lives in `Bun.serve`'s
 * own routing table rather than Elysia's (verified against Bun 1.4.2). Fetching
 * our own listener is the supported way to obtain the markup.
 *
 * The listener reference is shared with the dev asset proxy, which needs the
 * same URL to reach the routes Bun's own table owns — see `lifecycle/listener`.
 */

import { describeShellBuildFailure } from '@/server/lib/bundler/build-errors.server';
import { countOpenFileDescriptors, describeFdPressure, hasDescriptorHeadroom, type FdPressure } from '@/server/lib/lifecycle/fd-pressure';
import { DEV_ASSETS_ENABLED } from '@/server/lib/assets/dev-assets.server';
import { SHELL_ROUTE } from '@/server/lib/lifecycle/shell-route';
import { listenerFetchOptions, listenerUrl } from '@/server/lib/lifecycle/listener';

export type ShellRender = { ok: true; html: string } | { ok: false; reason: string };

/**
 * Descriptors one dev bundle of this app needs, measured on the real server:
 * 13 open on a freshly started process, 3354 after the first page load — a
 * single build of the client graph, which `development: true` then holds for
 * the life of the process (bun#40706). Production needs 6 (12 -> 18), because
 * it builds once ahead of time and holds nothing.
 *
 * Deliberately generous rather than exact: the number decides when to REFUSE
 * work, and refusing a healthy build would be a worse bug than the cascade this
 * guards against. It is a dev-mode figure only — see `renderShell`.
 */
const DEV_BUNDLE_DESCRIPTOR_COST = 3_600;

/**
 * Whether a bundle may be attempted right now, and the reason when it may not.
 *
 * Without this the failure cascades, which is exactly what was observed: the
 * build dies partway, so the browser is handed a bundle that cannot run, the
 * dev client reloads, and each attempt drives the table further down until
 * every spawn in the process fails. One refusal that names the real state is
 * worth more than a build that half-succeeds into a broken page.
 *
 * Production is exempt by construction: it bundles ahead of time and holds no
 * graph, so a descriptor count is not the thing that decides whether it can
 * serve — and `Bun.serve` caches the HTML route's output there anyway.
 */
export function shellBundleRefusal(pressure: FdPressure | null): string | null {
  if (!DEV_ASSETS_ENABLED) return null;
  if (hasDescriptorHeadroom(pressure, DEV_BUNDLE_DESCRIPTOR_COST)) return null;
  const detail = describeFdPressure(pressure) ?? 'The descriptor table is nearly full.';
  return `${detail} The page was NOT rebuilt, because a client bundle needs about `
    + `${DEV_BUNDLE_DESCRIPTOR_COST} descriptors and attempting it at this point fails partway — `
    + `which is what leaves the browser reloading a bundle that cannot run.`;
}

/**
 * Why the shell would not render, from the two facts that can explain it.
 *
 * Descriptor exhaustion comes first, and it has to: a truncated table makes the
 * bundle fail with messages that name the wrong cause entirely. Measured on the
 * real condition (a dev server past Darwin's 10,240-descriptor cliff) — Bun
 * reports the file reads it could not do as
 * `Could not resolve: "@kabmo-labs/plugin-sdk/app". Maybe you need to "bun install"?`,
 * which sends the reader to reinstall a dependency that is present and correct
 * while the actual fix is a restart. The build detail is still printed under it,
 * because it is the evidence, but it is labelled as the consequence it is.
 *
 * Pure so the composition can be pinned without reproducing a full table.
 */
export function composeShellFailureReason(input: {
  status: number;
  markupInvalid?: boolean;
  detail: string | null;
  pressure: FdPressure | null;
}): string {
  const pressure = describeFdPressure(input.pressure);
  if (pressure) {
    const head = input.markupInvalid
      ? 'The shell route answered with markup that is not the shell.'
      : `Shell route answered ${input.status}.`;
    const detail = input.detail
      ? `\n\nThe client bundle could not be built, which is a consequence of the same exhaustion:\n\n${input.detail}`
      : '';
    return `${head}\n\n${pressure}${detail}`;
  }
  if (input.detail) {
    const reason = input.markupInvalid ? 'The shell route answered with markup that is not the shell.' : `Shell route answered ${input.status}.`;
    return `${reason}\n\nThe client bundle does not build:\n\n${input.detail}`;
  }
  // Markup that is not the shell while the bundle builds cleanly means the
  // route is serving a CACHED failure: Bun caches the HTML route's output once
  // in production and never rebuilds it, so the empty body a failed first
  // request left behind outlives the fix. There is nothing to point at in the
  // source, and no amount of reloading helps — only a restart does.
  return 'The shell route answered with markup that is not the shell, and the client bundle builds cleanly.\n\n'
    + 'In production Bun caches the HTML route\'s output, so a build failure on the first request is cached as an empty page. Restart the server to rebuild it.';
}

/**
 * The reason for the current failure: the descriptor table is read FIRST,
 * because when it is exhausted every other symptom is downstream of it.
 *
 * Runs only on a failure, on a page that is already broken.
 */
async function shellFailureReason(status: number, markupInvalid = false): Promise<string> {
  const pressure = countOpenFileDescriptors();
  const detail = await describeShellBuildFailure();
  return composeShellFailureReason({ status, markupInvalid, detail, pressure });
}

/**
 * The bootstrap marker the SSR route substitutes, and therefore the one string
 * that proves the markup came from `index.html`.
 *
 * A status check alone is not enough, and the gap is not theoretical: with
 * `development: false` Bun caches the route's output, and a build that failed on
 * the FIRST request leaves it caching an EMPTY body answered `200`. Every later
 * request then looks successful, and the substitution below finds nothing to
 * replace — so the browser gets a blank page with a 200 and no way to tell why.
 * Measured on Bun 1.4.2: request 1 `500` + empty, requests 2..n `200` + empty,
 * and it stayed empty after the source was fixed, because the cached output is
 * never rebuilt in production. The marker turns that into the same actionable
 * page the development path already produces.
 */
export const SHELL_MARKER = '<!--app-bootstrap-->';

/**
 * The current shell markup, or a reason it could not be produced.
 *
 * Never cached: Bun re-renders the route per request in development, and in
 * production the manifest is already in memory — a cache here would be the one
 * thing that could serve markup pointing at a previous build's asset hashes.
 */
export async function renderShell(): Promise<ShellRender> {
  const base = listenerUrl();
  if (!base) return { ok: false, reason: 'The HTTP listener is not up yet.' };
  // Checked BEFORE the fetch, because the fetch is what makes Bun bundle the
  // page: past this point the damage is already done, and the browser has been
  // handed a bundle it will reload forever. See `shellBundleRefusal`.
  const refusal = shellBundleRefusal(countOpenFileDescriptors());
  if (refusal) return { ok: false, reason: refusal };
  try {
    // `listenerFetchOptions()` carries the TLS bypass under `--tls`: this is the
    // process asking its own listener, and its self-signed certificate would
    // otherwise fail the handshake and render "Shell not available" on every page.
    const response = await fetch(new URL(SHELL_ROUTE, base), listenerFetchOptions());
    if (!response.ok) return { ok: false, reason: await shellFailureReason(response.status) };
    const html = await response.text();
    if (!html.includes(SHELL_MARKER)) return { ok: false, reason: await shellFailureReason(response.status, true) };
    return { ok: true, html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: message };
  }
}
