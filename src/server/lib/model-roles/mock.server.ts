/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Demo catalog for the role dropdowns under `MOCK=true`.
 *
 * A demo install spawns no omp child, so `omp models` answers nothing and every
 * role dropdown would be empty. The chat rows come from the SAME demo catalog
 * `/api/models` serves in mock mode, so the role picker and the composer picker
 * name the same models; the non-chat rows exist because the five kind roles
 * accept a model of that kind only and would otherwise have no option at all.
 */

import { INITIAL_MODELS_CATALOG } from '@/client/data/models/catalog';
import type { ModelRoleCandidate } from '@/shared/types/model-roles';

const DEMO_KIND_MODELS: Array<Pick<ModelRoleCandidate, 'id' | 'name' | 'provider' | 'kind'>> = [
  { id: 'brave', name: 'Brave', provider: 'web', kind: 'search' },
  { id: 'deepseek', name: 'DeepSeek Search', provider: 'web', kind: 'search' },
  { id: 'gemma-3-1b', name: 'Gemma 3 1B', provider: 'local', kind: 'tiny' },
  { id: 'whisper-base', name: 'Whisper Base', provider: 'local', kind: 'stt' },
  { id: 'kokoro', name: 'Kokoro-82M', provider: 'local', kind: 'tts' },
  { id: 'flux-schnell', name: 'FLUX.1 Schnell', provider: 'local', kind: 'image' },
];

export function mockRoleCandidates(): ModelRoleCandidate[] {
  const chat: ModelRoleCandidate[] = INITIAL_MODELS_CATALOG.map((model) => ({
    selector: `${model.provider}/${model.id}`,
    id: model.id,
    name: model.name,
    provider: model.provider,
    kind: 'chat',
  }));
  return [
    ...chat,
    ...DEMO_KIND_MODELS.map((model) => ({ ...model, selector: `${model.provider}/${model.id}` })),
  ];
}
