/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The review surface's HTTP calls, typed.
 *
 * One module because three callers share the contract: the loading hook, the
 * save, and the delete. `root`/`repo` travel on every request — a document in a
 * nested repo is a different document from a same-named path at the workspace
 * root, and the server keys its rows by the resolved pair.
 *
 * A refusal is REPORTED, never swallowed: a save that silently failed would
 * leave the reader believing a judgement is stored when it is not, which is the
 * one failure this feature cannot tolerate.
 */

import type { AnnotationDraft, BlockVerdict, DocumentAnnotation, ReviewTarget } from '@/shared/lib/markdown/blocks/types';

/** The body a save sends, minus the scope the server resolves from root/repo. */
export interface SaveAnnotationBody {
  path: string;
  root?: string | null;
  repo?: string | null;
  blockKey: string;
  lineStart: number;
  lineEnd: number;
  verdict: BlockVerdict;
  note: string;
  quote: string;
}

function scopeParams(target: ReviewTarget): URLSearchParams {
  const params = new URLSearchParams({ path: target.path });
  if (target.root) params.set('root', target.root);
  if (target.repo && target.repo !== '.') params.set('repo', target.repo);
  return params;
}

/** The refusal text a failed request carries, or a status-shaped fallback. */
async function refusal(response: Response): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === 'string' ? payload.error : `Request failed (${response.status})`;
}

/** Every judgement stored for one document. */
export async function fetchAnnotations(target: ReviewTarget, signal?: AbortSignal): Promise<DocumentAnnotation[]> {
  const response = await fetch(`/api/review?${scopeParams(target).toString()}`, { signal });
  if (!response.ok) throw new Error(await refusal(response));
  const payload = (await response.json()) as { annotations?: DocumentAnnotation[] };
  return Array.isArray(payload.annotations) ? payload.annotations : [];
}

/** Store one judgement, answering the row as the server stored it. */
export async function saveAnnotation(target: ReviewTarget, draft: Omit<AnnotationDraft, 'scope' | 'path'>): Promise<DocumentAnnotation> {
  const body: SaveAnnotationBody = { ...draft, path: target.path, root: target.root, repo: target.repo };
  const response = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await refusal(response));
  const payload = (await response.json()) as { annotation?: DocumentAnnotation };
  if (!payload.annotation) throw new Error('The server answered without the saved annotation');
  return payload.annotation;
}

/** Remove one judgement. A missing row is an error, not a silent success. */
export async function removeAnnotation(id: string): Promise<void> {
  const response = await fetch(`/api/review?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!response.ok) throw new Error(await refusal(response));
}
