/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The body of `POST /api/sessions/:id/fork` for the fork composer.
 *
 * Same rule as the child-session spawn: a field the composer has no value for
 * is OMITTED, so the server keeps what the source transcript already carries.
 * A fork with no message is a real case — the branch is still created.
 */

import type { AgentImage } from '@/shared/types';
import type { ApprovalMode } from '@/shared/lib/omp/config/access-mode';

export interface ForkComposerPicks {
  prompt?: string | null;
  images?: AgentImage[] | null;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: string | null;
  accessMode?: ApprovalMode | null;
}

export function forkRequestBody(
  anchorEntryId: string | null | undefined,
  picks: ForkComposerPicks = {},
): Record<string, unknown> {
  const prompt = picks.prompt?.trim() ? picks.prompt.trim() : null;
  const images = picks.images?.length ? picks.images : null;
  const model = picks.model;
  return {
    ...(anchorEntryId ? { anchorEntryId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(images ? { images } : {}),
    ...(model?.provider && model.modelId ? { model } : {}),
    // `auto` means "leave the source transcript's level alone".
    ...(picks.thinkingLevel && picks.thinkingLevel !== 'auto'
      ? { thinkingLevel: picks.thinkingLevel }
      : {}),
    ...(picks.accessMode ? { accessMode: picks.accessMode } : {}),
  };
}
