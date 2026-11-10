/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The body of `POST /api/sessions/spawn` for a pending child chat.
 *
 * Split out so the payload rule can be asserted without mounting the composer:
 * every field the composer does not actually have a value for must be OMITTED,
 * never sent as `null` — the route treats an absent harness as "inherit the
 * parent's", and an absent model as "use the parent/project default".
 */

import type { AgentImage } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface ChildSpawnPicks {
  harness?: string | null;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  accessMode?: ApprovalMode | null;
  images?: AgentImage[] | null;
}

export function childSpawnBody(
  parentSessionId: string,
  prompt: string,
  picks: ChildSpawnPicks = {},
): Record<string, unknown> {
  const model = picks.model;
  return {
    parentSessionId,
    prompt,
    ...(picks.harness ? { harness: picks.harness } : {}),
    ...(model?.provider && model.modelId ? { model } : {}),
    // `auto` means "leave the agent's own level alone"; sending it would move a
    // configured level to a literal the ACP handshake may not accept.
    ...(picks.thinkingLevel && picks.thinkingLevel !== 'auto'
      ? { thinkingLevel: picks.thinkingLevel }
      : {}),
    ...(picks.accessMode ? { accessMode: picks.accessMode } : {}),
    ...(picks.images?.length ? { images: picks.images } : {}),
  };
}
