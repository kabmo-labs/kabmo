import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { upsertOmpProviderModels } from '@/server/lib/omp/config/providers';
import { manualModelSeed } from '@/server/lib/omp/config/provider-seeds';
import { readNativeProviders } from '@/server/lib/omp/config/models-config';
import { isProviderAuthMode, isProviderThinkingEffort, modelKindOf } from '@/shared/lib/models/provider/dialect';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

/**
 * POST /api/settings/provider-model — register ONE model by hand.
 *
 * A provider endpoint does not have to be listable to be usable: a gateway may
 * serve a model its `/models` route omits, a deployment may be named locally
 * (Azure), or the endpoint may have no listing route at all (Bedrock, Vertex).
 * The "Add model" dialog is that path, and it writes the same models.yml entry
 * the auto-fetch would.
 *
 * Body: { provider, id, name?, contextWindow?, maxTokens?, reasoning?,
 *   imageInput?, efforts?, costInput?, costOutput?, costCacheRead?,
 *   costCacheWrite?, baseUrl?, apiKey?, auth? }
 *   → { success, written, addedModels, alreadyKnown, reason? }
 *
 * `baseUrl`/`apiKey`/`auth` are only used when the provider has no models.yml
 * entry yet — an existing entry keeps its own endpoint and credential (the
 * writer is add-only). Registering the FIRST model under a provider omp only
 * knows from its bundled catalog therefore needs a real endpoint and key; the
 * refusal says so instead of writing half an entry.
 */

/** Context/output limits arrive as token counts; anything unusable is dropped. */
function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!provider || !id) {
      return json({ error: 'provider and model id are required' }, { status: 400 });
    }

    const rawEfforts = Array.isArray(body.efforts) ? body.efforts : [];
    const seed = manualModelSeed({
      id,
      name: typeof body.name === 'string' ? body.name : undefined,
      // An unknown kind is folded to chat rather than written: omp rejects the
      // whole file over one value outside its `MODEL_KINDS`.
      ...(typeof body.kind === 'string' ? { kind: modelKindOf(body.kind) } : {}),
      contextWindow: positiveInt(body.contextWindow),
      maxTokens: positiveInt(body.maxTokens),
      reasoning: body.reasoning === true,
      imageInput: body.imageInput === true,
      // An effort outside omp's vocabulary is dropped rather than written: the
      // schema rejects the whole file over one unknown level.
      efforts: rawEfforts.filter(isProviderThinkingEffort),
      costInput: typeof body.costInput === 'number' ? body.costInput : undefined,
      costOutput: typeof body.costOutput === 'number' ? body.costOutput : undefined,
      costCacheRead: typeof body.costCacheRead === 'number' ? body.costCacheRead : undefined,
      costCacheWrite: typeof body.costCacheWrite === 'number' ? body.costCacheWrite : undefined,
    });

    // Mock mode has no models.yml; the caller's own overlay row is the store.
    if (isMockMode()) {
      return json({ success: true, written: false, isMock: true, addedModels: [seed.id] });
    }

    // Read the registry BEFORE writing: `skippedModels` means "not added", not
    // "already there" — the writer also skips when it refuses to create a
    // provider it has no endpoint or credential for. The pre-write file is what
    // tells a genuine duplicate apart from that refusal, and reading it after
    // the write would count the model this call just added.
    const registeredBefore = await readNativeProviders();
    const alreadyKnown = registeredBefore
      .find((info) => info.slug === provider)
      ?.modelIds.includes(seed.id) === true;

    const result = await upsertOmpProviderModels(provider, {
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '',
      // A provider Kabmo overlay knows but models.yml does not needs the
      // credential to be created; a provider already in the file keeps its own
      // (the writer is add-only). A masked placeholder is dropped by the writer
      // rather than persisted as a credential.
      apiKey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : undefined,
      ...(isProviderAuthMode(body.auth) ? { auth: body.auth } : {}),
      overrideOnly: false,
      models: [seed],
    });
    if (result.written) invalidateModelsCaches();

    return json({
      success: result.written || alreadyKnown,
      written: result.written,
      addedModels: result.addedModels,
      backfilledModels: result.backfilledModels,
      alreadyKnown,
      reason: alreadyKnown
        ? `${seed.id} is already registered under "${provider}" in models.yml`
        : result.reason,
    }, { status: result.written || alreadyKnown ? 200 : 400 });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
