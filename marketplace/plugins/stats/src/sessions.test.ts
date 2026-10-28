/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session-title reader, against real files in a temp tree.
 *
 * The reader is small but every rule in it is a silent failure: a wrong title
 * slot reads as "unnamed" and the panel prints the short id, and a cache that
 * never invalidates pins the first name a session ever had. Both look like a
 * working panel, so the shapes are asserted against files the test writes.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sessionIdFromPath, titleForSessionFile } from './sessions';

const roots: string[] = [];

/** A throwaway directory, removed after each test. */
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stats-sessions-'));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A session file whose first line is the title slot omp writes. */
function writeSession(dir: string, id: string, title: string | null, pad = 114): string {
  const file = path.join(dir, `2026-10-15T00-00-00-000Z_${id}.jsonl`);
  const first = title === null
    ? '{"type":"session","version":3,"id":"' + id + '"}'
    : JSON.stringify({ type: 'title', v: 1, title, source: 'user', updatedAt: '2026-10-15T00:00:00.000Z', pad: ' '.repeat(pad) });
  fs.writeFileSync(file, `${first}\n{"type":"message"}\n`);
  return file;
}

describe('titleForSessionFile', () => {
  test('reads the title off the first line', () => {
    const dir = tempDir();
    const file = writeSession(dir, '01a13ceb-bb58-7351-baa5-30abb45cad14', '󰆊 OMP: Compare features');
    expect(titleForSessionFile(file)).toBe('󰆊 OMP: Compare features');
  });

  test('a file with no title slot answers null, not a guess', () => {
    const dir = tempDir();
    const file = writeSession(dir, '01a13ceb-bb58-7351-baa5-30abb45cad14', null);
    expect(titleForSessionFile(file)).toBeNull();
  });

  test('a whitespace-only title answers null', () => {
    const dir = tempDir();
    const file = writeSession(dir, '01a13ceb-bb58-7351-baa5-30abb45cad14', '   ');
    expect(titleForSessionFile(file)).toBeNull();
  });

  test('a missing file answers null rather than throwing', () => {
    expect(titleForSessionFile('/nonexistent/session.jsonl')).toBeNull();
  });

  test('a corrupt first line answers null', () => {
    const dir = tempDir();
    const file = path.join(dir, 'broken.jsonl');
    fs.writeFileSync(file, 'not json at all\n');
    expect(titleForSessionFile(file)).toBeNull();
  });

  test('a rename IN PLACE is picked up, because the cache keys on mtime', () => {
    // omp rewrites the title slot without changing the file's size, so a cache
    // keyed on the path alone would pin the first name forever.
    const dir = tempDir();
    const file = writeSession(dir, '01a13ceb-bb58-7351-baa5-30abb45cad14', 'Old name');
    expect(titleForSessionFile(file)).toBe('Old name');

    // Rewrite the same byte length with a different name, then bump mtime.
    const original = fs.readFileSync(file, 'utf8');
    const renamed = original.replace('Old name', 'New name');
    fs.writeFileSync(file, renamed);
    const future = new Date(Date.now() + 5_000);
    fs.utimesSync(file, future, future);

    expect(titleForSessionFile(file)).toBe('New name');
  });

  test('an unchanged file is served from the cache', () => {
    const dir = tempDir();
    const file = writeSession(dir, '01a13ceb-bb58-7351-baa5-30abb45cad14', 'Cached');
    expect(titleForSessionFile(file)).toBe('Cached');
    // A second read with no mtime change returns the same answer without
    // re-parsing — observable only as the value staying correct.
    expect(titleForSessionFile(file)).toBe('Cached');
  });
});

describe('sessionIdFromPath', () => {
  test('pulls the id out of a `--resume` operand', () => {
    expect(sessionIdFromPath('/Users/me/.omp/agent/sessions/-x/2026-10-15T00-00-00-000Z_01a13ceb-bb58-7351-baa5-30abb45cad14.jsonl')).toBe(
      '01a13ceb-bb58-7351-baa5-30abb45cad14',
    );
  });

  test('a path with no id answers null', () => {
    expect(sessionIdFromPath('/tmp/whatever.jsonl')).toBeNull();
  });
});
