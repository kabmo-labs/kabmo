/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Voice → Speech: the preference (from the `kabmo_settings` blob),
 * which hosted engines have a key, and whether omp's local `say` command can
 * actually run.
 *
 * The keys are written and cleared here and NOWHERE else, and this route never
 * returns one — a GET answers `hasKeys`. The config itself travels through
 * `/api/settings` like every other preference; only the credentials need their
 * own door, because the bootstrap ships that blob to the browser.
 *
 * `POST { action: 'probe' }` re-runs the local capability check. It exists
 * because the probe result is cached for a minute and a user who just updated
 * omp should be able to ask again without a restart.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isSameOriginRequest } from '@/server/lib/http/same-origin';
import { isMockMode } from '@/server/mock.server';
import {
  HOSTED_TTS_ENGINES,
  redactedTtsSettings,
  writeTtsApiKey,
  type HostedTtsEngine,
} from '@/server/lib/tts/settings.server';
import {
  invalidateLocalTtsCapability,
  localTtsCapability,
} from '@/server/lib/tts/local.server';

function isHostedEngine(value: unknown): value is HostedTtsEngine {
  const hosted: readonly string[] = HOSTED_TTS_ENGINES;
  return typeof value === 'string' && hosted.includes(value);
}

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const [settings, local] = await Promise.all([
      redactedTtsSettings(),
      localTtsCapability(),
    ]);
    return json({ settings, local, isMock: isMockMode() });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not read the speech settings.' },
      { status: 500 },
    );
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  // A key is a credential and this POST sets it: a cross-origin `no-cors` POST
  // would otherwise let another page install a key it controls.
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Cross-origin speech settings write rejected' }, { status: 403 });
  }

  try {
    const body: unknown = await request.json();
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

    if (record.action === 'probe') {
      invalidateLocalTtsCapability();
      return json({ success: true, local: await localTtsCapability(true) });
    }

    if (!isHostedEngine(record.engine)) {
      return json({ error: 'Pick a hosted speech engine first.' }, { status: 400 });
    }

    if (record.action === 'clear-key') {
      await writeTtsApiKey(record.engine, null);
      return json({ success: true, engine: record.engine, hasKey: false });
    }

    if (typeof record.apiKey === 'string') {
      const apiKey = record.apiKey.trim();
      if (!apiKey) return json({ error: 'The API key is empty.' }, { status: 400 });
      if (apiKey.length > 500) return json({ error: 'That is not an API key.' }, { status: 400 });
      await writeTtsApiKey(record.engine, apiKey);
      return json({ success: true, engine: record.engine, hasKey: true });
    }

    return json({ error: 'Unknown speech action.' }, { status: 400 });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not save the speech settings.' },
      { status: 500 },
    );
  }
}
