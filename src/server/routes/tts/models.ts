/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `GET/POST /api/tts/models` — the installed local speech models, the catalog of
 * ones this build can fetch, and the install jobs in flight.
 *
 * The settings page needs all three in one answer because they answer one
 * question: "what can I pick right now?". A model id in the settings blob is a
 * preference; whether that directory still exists is a server fact, and a picker
 * built from the preference alone offers a model that was deleted.
 *
 * Every mutating action is same-origin guarded: an install writes 150 MB to the
 * user's disk and a remove deletes it, so another page must not be able to
 * trigger either with a `no-cors` POST.
 */

import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isSameOriginRequest } from '@/server/lib/http/same-origin';
import { LOCAL_TTS_CATALOG } from '@/shared/lib/tts/local-models';
import { installJobs, installModel, removeModel } from '@/server/lib/tts/local-models.server';
import { listInstalledModels } from '@/server/lib/tts/model-manifest.server';
import { sherpaRuntime } from '@/server/lib/tts/engines/sherpa';

export async function loader({ request: _request }: LoaderFunctionArgs) {
  try {
    const [models, runtime] = await Promise.all([listInstalledModels(), sherpaRuntime()]);
    return json({
      models: models.map(({ dir: _dir, ...rest }) => rest),
      catalog: LOCAL_TTS_CATALOG,
      jobs: installJobs(),
      runtime,
    });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'Could not read the local speech models.' },
      { status: 500 },
    );
  }
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') return methodNotAllowed({ request, params });
  if (!isSameOriginRequest(request)) {
    return json({ error: 'Cross-origin model request rejected' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, { status: 400 });
  }
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
  const action = typeof record.action === 'string' ? record.action : '';

  try {
    if (action === 'install') {
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      const url = typeof record.url === 'string' ? record.url.trim() : '';
      if (!id && !url) return json({ error: 'Pick a model, or paste a link to one.' }, { status: 400 });
      if (url.length > 2000) return json({ error: 'That link is too long.' }, { status: 400 });
      const job = await installModel({ ...(id ? { id } : {}), ...(url ? { url } : {}) });
      return json({ success: true, job });
    }

    if (action === 'remove') {
      const id = typeof record.id === 'string' ? record.id.trim() : '';
      if (!id) return json({ error: 'Which model?' }, { status: 400 });
      await removeModel(id);
      return json({ success: true, id });
    }

    if (action === 'jobs') {
      return json({ success: true, jobs: installJobs() });
    }

    return json({ error: 'Unknown model action.' }, { status: 400 });
  } catch (error: unknown) {
    return json(
      { error: error instanceof Error ? error.message : 'The model request failed.' },
      { status: 400 },
    );
  }
}
