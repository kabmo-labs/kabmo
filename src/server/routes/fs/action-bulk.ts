/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Files panel's BULK actions: a multi-selection delete, and the two archive
 * verbs. Split from `action.ts` because that dispatcher is at the repository's
 * line ceiling, and because all three take path LISTS rather than the single
 * `path` the row actions are built around.
 */

import fs from 'node:fs';
import { json } from '@/server/lib/remix-compat';
import { resolveWithinRoot } from '@/server/lib/fs/root';
import { toRelPath } from '@/server/lib/fs/transfer';
import { isSinglePathSegment } from '@/server/lib/fs/path-segment';
import { compressEntries, extractArchive } from '@/server/lib/fs/archive';
import { COMPRESS_FORMATS } from '@/shared/lib/fs/archive';

/**
 * The Files panel's multi-select delete: one request, one resolved path per
 * entry. `paths` is JSON because a form field cannot repeat into an array with
 * a shape the route can trust; the single-row Delete keeps its own branch.
 */
export async function runBatchDeleteAction(options: { formData: FormData; scopedRoot: string }) {
  const { formData, scopedRoot } = options;
  let paths: unknown;
  try {
    paths = JSON.parse((formData.get('paths') as string) ?? '[]');
  } catch {
    return json({ error: 'Invalid delete list' }, { status: 400 });
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((entry) => typeof entry !== 'string')) {
    return json({ error: 'Invalid delete list' }, { status: 400 });
  }
  // Resolve EVERY path before removing any: one invalid entry must refuse the
  // batch, not delete the entries that came before it.
  const targets: { rel: string; full: string }[] = [];
  for (const rel of paths as string[]) {
    const target = resolveWithinRoot(scopedRoot, rel);
    if (!target) return json({ error: 'Invalid path' }, { status: 403 });
    targets.push({ rel, full: target });
  }
  const removed: string[] = [];
  for (const target of targets) {
    await fs.promises.rm(target.full, { recursive: true, force: true });
    removed.push(target.rel);
  }
  return json({ success: true, removed });
}

/**
 * `extract` and `compress`: the two archive verbs, one branch because they
 * share every piece of path validation.
 *
 * `compress` takes the whole selection as JSON `paths` plus the target file
 * name and the folder it lands in — the folder IS the working directory, which
 * is what keeps every stored name a plain relative one. `extract` takes one
 * archive and the folder to unpack into (`mkdir -p` is the tool's job).
 */
export async function runArchiveAction(options: { actionType: string; formData: FormData; scopedRoot: string }) {
  const { actionType, formData, scopedRoot } = options;
  if (actionType === 'extract') {
    const archiveRel = ((formData.get('path') as string) ?? '').trim();
    const archivePath = resolveWithinRoot(scopedRoot, archiveRel);
    if (!archivePath) return json({ error: 'Invalid path' }, { status: 403 });
    const destinationRel = ((formData.get('destination') as string) ?? '').trim() || '.';
    const destinationDir = resolveWithinRoot(scopedRoot, destinationRel);
    if (!destinationDir) return json({ error: 'Invalid destination' }, { status: 403 });
    const outcome = await extractArchive({ archivePath, destinationDir });
    if (!outcome.ok) return json({ error: outcome.error }, { status: outcome.status });
    return json({ success: true, path: toRelPath(scopedRoot, destinationDir) });
  }

  const formatRaw = (formData.get('format') as string) ?? 'zip';
  const format = COMPRESS_FORMATS.find((entry) => entry.id === formatRaw)?.id;
  if (!format) return json({ error: 'Unknown archive format' }, { status: 400 });
  const name = ((formData.get('name') as string) ?? '').trim();
  if (!isSinglePathSegment(name)) {
    return json({ error: 'Enter an archive name without a path separator' }, { status: 400 });
  }
  const destinationRel = ((formData.get('destination') as string) ?? '').trim() || '.';
  const destinationDir = resolveWithinRoot(scopedRoot, destinationRel);
  if (!destinationDir) return json({ error: 'Invalid destination' }, { status: 403 });

  let paths: unknown;
  try {
    paths = JSON.parse((formData.get('paths') as string) ?? '[]');
  } catch {
    return json({ error: 'Invalid selection' }, { status: 400 });
  }
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((entry) => typeof entry !== 'string')) {
    return json({ error: 'Select something to compress' }, { status: 400 });
  }
  const sources: string[] = [];
  for (const rel of paths as string[]) {
    const full = resolveWithinRoot(scopedRoot, rel);
    if (!full) return json({ error: 'Invalid path' }, { status: 403 });
    sources.push(full);
  }
  const outcome = await compressEntries({ destinationDir, name, format, sources });
  if (!outcome.ok) return json({ error: outcome.error }, { status: outcome.status });
  return json({ success: true, path: toRelPath(scopedRoot, outcome.path) });
}

