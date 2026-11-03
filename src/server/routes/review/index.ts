/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `/api/review` — a document's review annotations.
 *
 * GET    `?path=&root=&repo=` → `{ annotations, scope }`
 * POST   → upsert one judgement for one block
 * DELETE `?id=` → remove one
 *
 * The scope is resolved HERE, from the same `root`/`repo` pair every other file
 * route takes, so an annotation can never name a directory the caller could not
 * read: `resolveRoot` falls back the same way and `resolveWithinRoot` refuses an
 * escape. The stored key is `<resolvedRoot>\0<repo>`, the spelling the realtime
 * workspace topics already use for the same pair.
 */

import { json, NO_STORE_HEADERS } from '@/server/lib/remix-compat';
import type { ActionFunctionArgs, LoaderFunctionArgs } from '@/server/lib/remix-compat';
import { methodNotAllowedResponse } from '@/server/lib/route-adapter';
import { getDefaultFsRoot, resolveRoot, resolveWithinRoot } from '@/server/lib/fs/root';
import { normalizeRelativePath } from '@/server/lib/fs/relative-path';
import { isMockMode } from '@/server/mock.server';
import { deleteAnnotation, listAnnotations, saveAnnotation } from '@/server/lib/review/store.server';
import type { BlockVerdict } from '@/shared/lib/markdown/blocks/types';

/** The scope key for one (root, repo) pair, or null when the pair is invalid. */
async function resolveScope(root: string | null, repo: string | null): Promise<{ scope: string; repo: string } | null> {
  const resolvedRoot = await resolveRoot(root, await getDefaultFsRoot(isMockMode()));
  const scopedRepo = repo && repo !== '.' ? repo : '.';
  // A nested repo is only valid INSIDE this root; anything else is the same 403
  // `/api/fs/dir` answers rather than a silently different document.
  if (scopedRepo !== '.' && resolveWithinRoot(resolvedRoot, scopedRepo) === null) return null;
  return { scope: `${resolvedRoot}\u0000${scopedRepo}`, repo: scopedRepo };
}

function normalizedPath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  return normalizeRelativePath(raw);
}

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const path = normalizedPath(url.searchParams.get('path'));
  if (!path) return json({ error: 'path is required' }, { status: 400, headers: NO_STORE_HEADERS });
  const target = await resolveScope(url.searchParams.get('root'), url.searchParams.get('repo'));
  if (!target) return json({ error: 'Invalid repo path' }, { status: 403, headers: NO_STORE_HEADERS });

  const annotations = await listAnnotations(target.scope, path);
  return json({ annotations, scope: target.scope }, { headers: NO_STORE_HEADERS });
}

/** One field at a time, so a bad body names what is wrong instead of "invalid". */
interface ParsedBody {
  scope?: never;
  root: string | null;
  repo: string | null;
  path: string | null;
  blockKey: string | null;
  lineStart: number;
  lineEnd: number;
  verdict: BlockVerdict | null;
  note: string;
  quote: string;
}

function parseBody(raw: unknown): ParsedBody | string {
  if (typeof raw !== 'object' || raw === null) return 'body must be an object';
  const body = raw as Record<string, unknown>;
  const blockKey = typeof body.blockKey === 'string' ? body.blockKey.trim() : '';
  if (!blockKey) return 'blockKey is required';
  if (body.verdict !== 'good' && body.verdict !== 'needs-work') return 'verdict must be "good" or "needs-work"';
  const line = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
  return {
    root: typeof body.root === 'string' ? body.root : null,
    repo: typeof body.repo === 'string' ? body.repo : null,
    path: normalizedPath(body.path),
    blockKey,
    lineStart: line(body.lineStart),
    lineEnd: line(body.lineEnd),
    verdict: body.verdict,
    note: typeof body.note === 'string' ? body.note.slice(0, 4000) : '',
    quote: typeof body.quote === 'string' ? body.quote.slice(0, 400) : '',
  };
}

async function saveFrom({ request }: ActionFunctionArgs) {
  const parsed = parseBody(await request.json().catch(() => null));
  if (typeof parsed === 'string') return json({ error: parsed }, { status: 400 });
  if (!parsed.path) return json({ error: 'path is required' }, { status: 400 });
  if (!parsed.verdict) return json({ error: 'verdict is required' }, { status: 400 });
  const target = await resolveScope(parsed.root, parsed.repo);
  if (!target) return json({ error: 'Invalid repo path' }, { status: 403 });

  const annotation = await saveAnnotation({
    scope: target.scope,
    path: parsed.path,
    blockKey: parsed.blockKey as string,
    lineStart: parsed.lineStart,
    lineEnd: parsed.lineEnd,
    verdict: parsed.verdict,
    note: parsed.note,
    quote: parsed.quote,
  });
  return json({ annotation }, { headers: NO_STORE_HEADERS });
}

async function removeFrom({ request }: ActionFunctionArgs) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'id is required' }, { status: 400 });
  const removed = await deleteAnnotation(id);
  if (!removed) return json({ error: 'No annotation with that id' }, { status: 404 });
  return json({ success: true }, { headers: NO_STORE_HEADERS });
}

export async function action(args: ActionFunctionArgs) {
  switch (args.request.method) {
    case 'POST':
      return saveFrom(args);
    case 'DELETE':
      return removeFrom(args);
    default:
      return methodNotAllowedResponse();
  }
}
