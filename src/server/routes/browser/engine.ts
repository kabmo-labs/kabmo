/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * GET/POST /api/browser/engine — which engine the agent's browser will use.
 *
 * The Browser Agent panel mirrors the project-shared Chromium over CDP. omp's
 * own WebKit engine has no CDP endpoint, so a session on WebKit can never
 * appear in the panel. This route is how the panel knows to say that instead
 * of waiting for a frame that cannot arrive, and how its button switches the
 * agent to Chromium.
 *
 * The write is `browser.webkit = false` through the same `omp config set` the
 * settings panel uses — one writer, so the two cannot disagree. omp reads the
 * key at open time (measured: a tab opened after the write used the shared
 * Chromium daemon in the same running session), so no restart is needed.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed, parseJsonBody } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { setOmpConfigValue } from '@/server/lib/omp/config/config-cli';
import { readBrowserEngineState } from '@/server/lib/browser/engine';

export async function loader() {
  return json({ ...(await readBrowserEngineState()), mock: isMockMode() });
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  if (isMockMode()) {
    return json({ error: 'config writes are unavailable in mock mode' }, { status: 503 });
  }
  const parsed = await parseJsonBody<{ webkit?: unknown }>(request);
  if (!parsed.ok) return json({ error: 'Invalid JSON body' }, { status: 400 });
  const webkit = parsed.body?.webkit;
  if (typeof webkit !== 'boolean') {
    return json({ error: 'webkit must be a boolean' }, { status: 400 });
  }
  try {
    await setOmpConfigValue('browser.webkit', webkit);
    return json({ ...(await readBrowserEngineState()), mock: false });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
