/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Settings → Dictation: the preference (from the `kabmo_settings` blob), whether
 * an API key exists, and whether the local engine can actually run.
 *
 * The key is written and cleared here and NOWHERE else, and this route never
 * returns it — a GET answers `hasApiKey`. The config itself travels through
 * `/api/settings` like every other preference; only the credential needs its own
 * door, because the bootstrap ships that blob to the browser.
 *
 * `POST { action: 'probe' }` re-runs the local capability check. It exists
 * because the probe result is cached for a minute and a user who just updated
 * omp should be able to ask again without a restart.
 */

import { json } from '@kabmo-labs/kabmo-http';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@kabmo-labs/kabmo-http';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isSameOriginRequest } from '@/server/lib/http/same-origin';
import {
  redactedDictationSettings,
  writeDictationApiKey,
} from '@/server/lib/dictation/settings.server';
import {
  invalidateLocalDictationCapability,
  localDictationCapability,
} from '@/server/lib/dictation/capability.server';
import { isMockMode } from '@kabmo-labs/kabmo-runtime-flags';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const [settings, local] = await Promise.all([
      redactedDictationSettings(),
      localDictationCapability(),
    ]);
    return json({ settings, local, isMock: isMockMode() });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not read the dictation settings.' },
      { status: 500 },
    );
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  // The key is a credential and this POST sets it: a cross-origin `no-cors`
  // POST would otherwise let another page install a key it controls.
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Cross-origin dictation settings write rejected' }, { status: 403 });
  }

  try {
    const body: unknown = await request.json();
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};

    if (record.action === 'clear-key') {
      await writeDictationApiKey(null);
      return json({ success: true, hasApiKey: false });
    }

    if (record.action === 'probe') {
      invalidateLocalDictationCapability();
      return json({ success: true, local: await localDictationCapability(true) });
    }

    if (typeof record.apiKey === 'string') {
      const apiKey = record.apiKey.trim();
      if (!apiKey) return json({ error: 'The API key is empty.' }, { status: 400 });
      if (apiKey.length > 500) return json({ error: 'That is not an API key.' }, { status: 400 });
      await writeDictationApiKey(apiKey);
      return json({ success: true, hasApiKey: true });
    }

    return json({ error: 'Unknown dictation action.' }, { status: 400 });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not save the dictation settings.' },
      { status: 500 },
    );
  }
}
