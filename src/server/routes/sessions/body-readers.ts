/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The JSON body readers shared by the session routes that accept a composer's
 * picks: `/api/sessions/spawn` and `/api/sessions/:id/fork`.
 *
 * One copy, because the two endpoints promise the same shape (`harness`-style
 * explicit picks, a model pair, images) and a second parser would drift into
 * accepting something the other refuses.
 */

import type { AgentImage } from '@/shared/types/omp/agent';
import type { SelectedModel } from '@/shared/types/models';

/** A trimmed non-empty string, or null — the routes' "absent" spelling. */
export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** A `{provider, modelId}` pair, or null when either half is missing. */
export function readModel(value: unknown): SelectedModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return typeof record.provider === 'string' && typeof record.modelId === 'string'
    ? { provider: record.provider, modelId: record.modelId }
    : null;
}

/** Image parts of a prompt, dropping entries without bytes or a MIME type. */
export function readImages(value: unknown): AgentImage[] | null {
  if (!Array.isArray(value)) return null;
  const images = value.flatMap((entry): AgentImage[] => {
    if (!entry || typeof entry !== 'object') return [];
    const record = entry as Record<string, unknown>;
    return typeof record.data === 'string' && typeof record.mimeType === 'string'
      ? [{ type: 'image', data: record.data, mimeType: record.mimeType }]
      : [];
  });
  return images.length ? images : null;
}
