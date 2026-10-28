/**
 * @license
 * SPDX-License-Identifier: MIT
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { join } from 'path';

import { readSubagentTranscriptPage } from '@/server/lib/omp/subagent/history/transcript';

const tempDirs: string[] = [];

/** Build a parent session file plus its sibling artifacts dir. */
async function makeSession(childFiles: Record<string, string>): Promise<string> {
  const dir = await fs.promises.mkdtemp('omp-transcript-');
  tempDirs.push(dir);
  const sessionFile = join(dir, 'parent.jsonl');
  await Bun.write(sessionFile, '{"type":"session"}\n');
  const siblingDir = join(dir, 'parent');
  await fs.promises.mkdir(siblingDir, { recursive: true });
  for (const [name, body] of Object.entries(childFiles)) {
    await Bun.write(join(siblingDir, name), body);
  }
  return sessionFile;
}

afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const twoLines = '{"type":"message","id":"1"}\n{"type":"message","id":"2"}\n';

describe('readSubagentTranscriptPage', () => {
  test('resolves a page for a child transcript on disk', async () => {
    const sessionFile = await makeSession({ 'child.jsonl': twoLines });
    const page = await readSubagentTranscriptPage(sessionFile, 'child', 0);
    expect(page).not.toBeNull();
    expect(page!.messages).toHaveLength(2);
    expect(page!.totalBytes).toBe(Buffer.byteLength(twoLines, 'utf8'));
    expect(page!.nextByte).toBe(Buffer.byteLength(twoLines, 'utf8'));
  });

  test('returns null for an unknown subagent id', async () => {
    const sessionFile = await makeSession({ 'child.jsonl': twoLines });
    expect(await readSubagentTranscriptPage(sessionFile, 'missing', 0)).toBeNull();
  });

  test('rejects ids that do not match the grammar before touching the fs', async () => {
    const sessionFile = await makeSession({ 'child.jsonl': twoLines });
    for (const id of ['../etc/passwd', 'a/b', '', 'x'.repeat(101)]) {
      expect(await readSubagentTranscriptPage(sessionFile, id, 0)).toBeNull();
    }
  });

  test('refuses a symlink that escapes the sibling dir', async () => {
    const sessionFile = await makeSession({});
    const dir = tempDirs[tempDirs.length - 1];
    const outside = join(dir, 'outside.jsonl');
    await Bun.write(outside, '{"secret":true}\n');
    await fs.promises.symlink(outside, join(dir, 'parent', 'escaped.jsonl'));
    expect(await readSubagentTranscriptPage(sessionFile, 'escaped', 0)).toBeNull();
  });

  test('pages forward by byte window and resets past the end', async () => {
    const sessionFile = await makeSession({ 'child.jsonl': twoLines });
    const first = await readSubagentTranscriptPage(sessionFile, 'child', 0, 30);
    expect(first!.messages).toHaveLength(1);
    expect(first!.nextByte).toBeGreaterThan(0);

    const second = await readSubagentTranscriptPage(sessionFile, 'child', first!.nextByte, 30);
    expect(second!.messages).toHaveLength(1);
    expect(second!.nextByte).toBe(Buffer.byteLength(twoLines, 'utf8'));

    const past = await readSubagentTranscriptPage(sessionFile, 'child', 99_999, 30);
    expect(past!.reset).toBe(true);
    expect(past!.fromByte).toBe(0);
  });

  test('returns null when the parent has no sibling artifacts dir', async () => {
    const dir = await fs.promises.mkdtemp('omp-transcript-');
    tempDirs.push(dir);
    const sessionFile = join(dir, 'lonely.jsonl');
    await Bun.write(sessionFile, '{"type":"session"}\n');
    expect(await readSubagentTranscriptPage(sessionFile, 'child', 0)).toBeNull();
  });
});
