import { json } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowed } from '@/server/lib/route-adapter';
import { isMockMode } from '@/server/mock.server';
import { writeModelOverride, type ReasoningEffort } from '@/server/lib/omp/config/model-overrides';
import { invalidateModelsCaches } from '@/shared/lib/models/server-cache';

/**
 * PUT /api/settings/model-override — the per-model knobs omp actually honours.
 *
 * omp resolves `maxTokens` and the reasoning `thinking` block per model from
 * models.yml `modelOverrides`, and has no per-model temperature/topP at all
 * (those exist only as global `config.yml` settings, editable in Settings →
 * OMP Engine). Writing Kabmo's model dialog anywhere else made its
 * controls inert, so this route is the one that reaches the agent.
 *
 * Body: { provider, modelId, maxTokens?: number|null, reasoningEffort?: string|null }
 */

const EFFORTS: readonly ReasoningEffort[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== 'PUT' && request.method !== 'POST') {
    return methodNotAllowed({ request, params });
  }
  try {
    const body = await request.json() as {
      provider?: unknown;
      modelId?: unknown;
      maxTokens?: unknown;
      reasoningEffort?: unknown;
    };
    const provider = typeof body.provider === 'string' ? body.provider.trim() : '';
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
    if (!provider || !modelId) {
      return json({ error: 'provider and modelId are required' }, { status: 400 });
    }

    // `null` means "clear the override"; `undefined` means "leave it alone".
    let maxTokens: number | null | undefined;
    if (body.maxTokens === null) maxTokens = null;
    else if (typeof body.maxTokens === 'number' && Number.isFinite(body.maxTokens) && body.maxTokens > 0) {
      maxTokens = Math.round(body.maxTokens);
    } else if (body.maxTokens !== undefined) {
      return json({ error: 'maxTokens must be a positive number or null' }, { status: 400 });
    }

    let reasoningEffort: ReasoningEffort | null | undefined;
    if (body.reasoningEffort === null) reasoningEffort = null;
    else if (typeof body.reasoningEffort === 'string' && (EFFORTS as readonly string[]).includes(body.reasoningEffort)) {
      reasoningEffort = body.reasoningEffort as ReasoningEffort;
    } else if (body.reasoningEffort !== undefined) {
      return json({ error: `reasoningEffort must be one of ${EFFORTS.join(', ')} or null` }, { status: 400 });
    }

    if (maxTokens === undefined && reasoningEffort === undefined) {
      return json({ error: 'nothing to write' }, { status: 400 });
    }

    // Mock mode has no models.yml to edit; the overlay already carries the value.
    if (isMockMode()) return json({ success: true, written: false, isMock: true });

    const result = await writeModelOverride({ provider, modelId, maxTokens, reasoningEffort });
    if (result.written) invalidateModelsCaches();
    return json({ success: result.written, ...result });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
