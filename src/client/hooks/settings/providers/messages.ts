/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What to TELL the user after a provider was added or re-fetched.
 *
 * The message depends on the shape that was written, not on the model count,
 * because two of the three shapes have no local model list BY DESIGN: a
 * discovery provider is listed by omp at runtime, and an endpoint override
 * leaves the models to omp's own catalog. Reporting "0 models" for either made
 * a registration that succeeded read as a failure.
 */

import type { ProviderItem } from '@/shared/types';

/** The success/failure line for an Add Provider submission. */
export function addProviderMessage(
  provider: ProviderItem,
  options: { fetchedCount: number; ompNote?: string },
): { text: string; tone: 'success' | 'error' } {
  if (provider.modelSource === 'discovery') {
    return { text: `${provider.name} registered — omp discovers its models on each run.`, tone: 'success' };
  }
  if (provider.modelSource === 'override') {
    return {
      text: `${provider.name} endpoint registered — omp keeps its own model list for this provider.`,
      tone: 'success',
    };
  }
  if (options.fetchedCount > 0) {
    return {
      text: `Fetched ${options.fetchedCount} new model${options.fetchedCount === 1 ? '' : 's'} from the provider.`,
      tone: 'success',
    };
  }
  if (options.fetchedCount === -1) {
    // The listing failed. When omp reported a reason it is the actionable half,
    // so it is quoted rather than replaced by a generic line.
    return {
      text: options.ompNote
        ? `Provider registered, but models could not be listed: ${options.ompNote}`
        : 'Auto-fetch models failed — provider added with default models.',
      tone: 'error',
    };
  }
  return { text: `${provider.name} registered — no new models to add.`, tone: 'success' };
}

/**
 * The line reported after a fetch REPLACED the provider's model list: what the
 * listing brought in, and what left because the endpoint no longer serves it.
 * One line, because a fetch that only removed ids is as much a result as one
 * that only added them — and the user has to be able to tell them apart.
 */
export function fetchModelsMessage(counts: { addedCount: number; removedCount: number }): {
  text: string;
  tone: 'success' | 'error';
} {
  const plural = (count: number) => (count === 1 ? '' : 's');
  if (counts.addedCount > 0 && counts.removedCount > 0) {
    return {
      text: `Fetched ${counts.addedCount} new model${plural(counts.addedCount)} and removed ${counts.removedCount} the provider no longer serves.`,
      tone: 'success',
    };
  }
  if (counts.addedCount > 0) {
    return {
      text: `Fetched ${counts.addedCount} new model${plural(counts.addedCount)} from the provider.`,
      tone: 'success',
    };
  }
  if (counts.removedCount > 0) {
    return {
      text: `Removed ${counts.removedCount} model${plural(counts.removedCount)} the provider no longer serves.`,
      tone: 'success',
    };
  }
  return { text: 'Models refreshed — the list already matches the provider.', tone: 'success' };
}

/**
 * The extra line reported after a manual "fetch models": what Kabmo wrote
 * into `models.yml` versus what omp already had. A file write and a model-count
 * change are different outcomes, and conflating them hid a failed write.
 */
export function fetchModelsNote(result: {
  omp?: { written: boolean; addedCount: number; backfilledCount: number; removedCount?: number; reason?: string };
}): { text: string; tone: 'success' | 'error' } | null {
  if (!result.omp) return null;
  if (result.omp.written) {
    const parts: string[] = [];
    if (result.omp.addedCount > 0) {
      parts.push(`${result.omp.addedCount} new model${result.omp.addedCount === 1 ? '' : 's'} registered`);
    }
    if (result.omp.backfilledCount > 0) {
      parts.push(`${result.omp.backfilledCount} model${result.omp.backfilledCount === 1 ? '' : 's'} enriched`);
    }
    if ((result.omp.removedCount ?? 0) > 0) {
      parts.push(`${result.omp.removedCount} model${result.omp.removedCount === 1 ? '' : 's'} removed`);
    }
    return {
      text: `omp models.yml updated${parts.length > 0 ? `: ${parts.join(', ')}` : ''}.`,
      tone: 'success',
    };
  }
  if (result.omp.reason) {
    return { text: `omp models.yml not updated: ${result.omp.reason}`, tone: 'error' };
  }
  return null;
}

/**
 * The line reported after omp re-ran model discovery.
 *
 * The refresh is CATALOG-WIDE (`omp models refresh` is the only granularity omp
 * offers), so a per-provider report would overstate what happened. Saying so is
 * the honest half: the counts are this provider's, and the run covered all of
 * them.
 */
export function refreshModelsMessage(
  providerName: string,
  result: { added: number; removed: number },
): { text: string; tone: 'success' | 'error' } {
  const plural = (count: number) => (count === 1 ? '' : 's');
  if (result.added > 0 || result.removed > 0) {
    const parts: string[] = [];
    if (result.added > 0) parts.push(`${result.added} new model${plural(result.added)}`);
    if (result.removed > 0) parts.push(`${result.removed} model${plural(result.removed)} gone`);
    return {
      text: `${providerName}: ${parts.join(', ')} after omp re-ran discovery.`,
      tone: 'success',
    };
  }
  return {
    text: `${providerName}: omp re-ran discovery — this provider's list is unchanged.`,
    tone: 'success',
  };
}
