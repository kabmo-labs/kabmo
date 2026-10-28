/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `artifact://<id>` reference a truncated result carries.
 *
 * The shape is omp's own, taken from a real result: the id sits under
 * `details.meta.limits.columnTruncated.artifactId`, and the kind is NOT in that
 * record — it comes from the tool that produced the result, which is what tells
 * an `eval` artifact from a `bash` one under the same id.
 *
 * Pure function, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import { artifactRefOf, artifactUrl } from '@/shared/lib/chat/tool/artifact';
import type { ToolCallData } from '@/shared/types/chat';

function tool(partial: Partial<ToolCallData> & Pick<ToolCallData, 'type'>): ToolCallData {
  return { id: 'c1', name: partial.type, title: partial.type, ...partial } as ToolCallData;
}

describe('artifactRefOf', () => {
  test('reads the id omp recorded on a truncated result', () => {
    const ref = artifactRefOf(tool({
      type: 'bash',
      details: { meta: { limits: { columnTruncated: { maxColumn: 768, unit: 'bytes', artifactId: '420' } } } },
    }));
    expect(ref).toEqual({ id: '420', kind: 'bash', elidedBytes: undefined });
  });

  test('carries the elided byte count when omp reported one', () => {
    const ref = artifactRefOf(tool({
      type: 'eval',
      details: { meta: { limits: { columnTruncated: { artifactId: '213', artifactElidedBytes: 4096 } } } },
    }));
    expect(ref).toEqual({ id: '213', kind: 'eval', elidedBytes: 4096 });
  });

  test('derives the kind from the tool, not from the record', () => {
    expect(artifactRefOf(tool({
      type: 'read',
      details: { meta: { limits: { columnTruncated: { artifactId: '7' } } } },
    }))?.kind).toBe('read');
  });

  test('returns null without a truncation record', () => {
    expect(artifactRefOf(tool({ type: 'bash', details: { wallTimeMs: 12 } }))).toBeNull();
  });

  test('refuses a non-numeric id, which could never name a file', () => {
    expect(artifactRefOf(tool({
      type: 'bash',
      details: { meta: { limits: { columnTruncated: { artifactId: '../../etc/passwd' } } } },
    }))).toBeNull();
  });

  test('returns null when there are no details at all', () => {
    expect(artifactRefOf(tool({ type: 'bash' }))).toBeNull();
  });
});

describe('artifactUrl', () => {
  test('names the session, the id and the kind', () => {
    const url = artifactUrl('abc', { id: '420', kind: 'bash' });
    expect(url).toBe('/api/omp/artifact?sessionId=abc&id=420&kind=bash');
  });

  test('omits the kind when the tool did not resolve one', () => {
    expect(artifactUrl('abc', { id: '9' })).toBe('/api/omp/artifact?sessionId=abc&id=9');
  });
});
