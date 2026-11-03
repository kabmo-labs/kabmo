/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * SQLite-backed store for a document's review annotations.
 *
 * One row per (scope, path, block key), and a save is an UPSERT: a block carries
 * one judgement, and a second click changes the answer rather than stacking a
 * thread. The `UNIQUE` constraint in the schema is the enforcement — two tabs
 * saving the same block at once ends with one row, not two.
 *
 * `created_at` is preserved across an upsert while `updated_at` moves, so
 * "oldest note first" and "most recently touched" are both answerable.
 */

import { randomUUID } from 'node:crypto';

import { getDb } from '@/server/db.server';
import type { DocumentAnnotation, BlockVerdict } from '@/shared/lib/markdown/blocks/types';

interface AnnotationRow {
  id: string;
  scope: string;
  path: string;
  block_key: string;
  line_start: number;
  line_end: number;
  verdict: string;
  note: string;
  quote: string;
  created_at: number;
  updated_at: number;
}

function isVerdict(value: unknown): value is BlockVerdict {
  return value === 'good' || value === 'needs-work';
}

function toAnnotation(row: AnnotationRow): DocumentAnnotation {
  return {
    id: row.id,
    scope: row.scope,
    path: row.path,
    blockKey: row.block_key,
    lineStart: row.line_start,
    lineEnd: row.line_end,
    // A row written by a future version with a third verdict reads as
    // `needs-work` rather than disappearing: a judgement that cannot be
    // interpreted is still a block the user flagged.
    verdict: isVerdict(row.verdict) ? row.verdict : 'needs-work',
    note: row.note,
    quote: row.quote,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Every judgement stored for one document, oldest first. */
export async function listAnnotations(scope: string, path: string): Promise<DocumentAnnotation[]> {
  const db = await getDb();
  const rows = (await db.all(
    'SELECT * FROM document_annotations WHERE scope = ? AND path = ? ORDER BY created_at ASC',
    [scope, path],
  )) as AnnotationRow[];
  return rows.map(toAnnotation);
}

export interface AnnotationInput {
  scope: string;
  path: string;
  blockKey: string;
  lineStart: number;
  lineEnd: number;
  verdict: BlockVerdict;
  note: string;
  quote: string;
}

/** Insert or replace the judgement for one block, and answer the stored row. */
export async function saveAnnotation(input: AnnotationInput): Promise<DocumentAnnotation> {
  const db = await getDb();
  const now = Date.now();
  const existing = (await db.get(
    'SELECT id, created_at FROM document_annotations WHERE scope = ? AND path = ? AND block_key = ?',
    [input.scope, input.path, input.blockKey],
  )) as { id: string; created_at: number } | undefined;
  const id = existing?.id ?? randomUUID();
  const createdAt = existing?.created_at ?? now;

  await db.run(
    `INSERT INTO document_annotations
       (id, scope, path, block_key, line_start, line_end, verdict, note, quote, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (scope, path, block_key) DO UPDATE SET
       line_start = excluded.line_start,
       line_end = excluded.line_end,
       verdict = excluded.verdict,
       note = excluded.note,
       quote = excluded.quote,
       updated_at = excluded.updated_at`,
    [
      id,
      input.scope,
      input.path,
      input.blockKey,
      input.lineStart,
      input.lineEnd,
      input.verdict,
      input.note,
      input.quote,
      createdAt,
      now,
    ],
  );

  return {
    id,
    scope: input.scope,
    path: input.path,
    blockKey: input.blockKey,
    lineStart: input.lineStart,
    lineEnd: input.lineEnd,
    verdict: input.verdict,
    note: input.note,
    quote: input.quote,
    createdAt,
    updatedAt: now,
  };
}

/** Remove one judgement. `false` means there was no row with that id. */
export async function deleteAnnotation(id: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.run('DELETE FROM document_annotations WHERE id = ?', [id]);
  return result.changes > 0;
}
