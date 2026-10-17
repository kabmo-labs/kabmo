/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The session-discovery layer: resolving a session UUID to its file, scanning
 * one file into a sidebar row, rolling up its telemetry, and answering the
 * cached "does it have subagents?" probe.
 *
 * Each piece has a silent failure mode this pins:
 *
 *  - `findSessionFileById` is on the hot path of eight routes and is served by
 *    an `id → path` index; a session created since the index was built must
 *    still resolve, which is what the miss re-check is for.
 *  - `scanSessionInfo` turns bytes into the row: a title slot must beat the
 *    header title, a header-less file must yield undefined rather than throw,
 *    and `firstMessage` must fall back to a marker rather than empty.
 *  - `sessionHasSubagents` is version-keyed on (last-entry timestamp, sibling
 *    dir mtime) so a removed sibling directory must invalidate a cached `true`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'node:os';

import { findSessionFileById, resolveSessionFileOr404, resolveSessionPathOr404, sessionNotFoundResponse } from '@/server/lib/omp/session/locator';
import { scanSessionInfo } from '@/server/lib/omp/session/scan';
import { sessionHasSubagents } from '@/server/lib/omp/session/subagent-presence';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';

const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  // `os.tmpdir()`, not a `/tmp` fallback: there is no `/tmp` on Windows, and a
  // POSIX-literal root resolves against the current drive — the fixture tree then
  // never exists where the scan looks for it.
  const dir = fs.mkdtempSync(join(tmpdir(), `${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

/** Write a JSONL session file, creating its directory. */
function writeSessionFile(filePath: string, lines: unknown[]): string {
  fs.mkdirSync(dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return filePath;
}

function header(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'session', version: 3, id, cwd: '/tmp/proj', timestamp: '2026-09-01T00:00:00.000Z', ...extra };
}

function userMessage(text: string, timestamp: string): Record<string, unknown> {
  return { type: 'message', timestamp, message: { role: 'user', content: text } };
}

afterAll(() => {
  clearSessionFileCaches();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('findSessionFileById', () => {
  test('resolves an id to its file path under the sessions root', async () => {
    const root = tempDir('sess-root');
    const file = writeSessionFile(join(root, 'proj-a', 'id-one.jsonl'), [header('id-one')]);
    clearSessionFileCaches();
    expect(await findSessionFileById('id-one', root)).toBe(file);
  });

  test('returns undefined for an unknown id', async () => {
    const root = tempDir('sess-root');
    writeSessionFile(join(root, 'proj-a', 'id-one.jsonl'), [header('id-one')]);
    clearSessionFileCaches();
    expect(await findSessionFileById('nope', root)).toBeUndefined();
  });

  test('a session created after the index was built resolves on the miss re-check', async () => {
    const root = tempDir('sess-root');
    const first = writeSessionFile(join(root, 'proj-a', 'id-one.jsonl'), [header('id-one')]);
    clearSessionFileCaches();
    expect(await findSessionFileById('id-one', root)).toBe(first);
    const second = writeSessionFile(join(root, 'proj-a', 'id-two.jsonl'), [header('id-two')]);
    expect(await findSessionFileById('id-two', root)).toBe(second);
  });

  test('an empty sessions root answers undefined instead of throwing', async () => {
    clearSessionFileCaches();
    expect(await findSessionFileById('anything', tempDir('sess-empty'))).toBeUndefined();
  });
});

describe('session resolve guards', () => {
  let previousAgentDir: string | undefined;
  let previousXdg: string | undefined;
  let agentDir: string;
  let sessionsRoot: string;

  beforeAll(() => {
    agentDir = tempDir('sess-agent');
    sessionsRoot = join(agentDir, 'sessions');
    previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;
    previousXdg = Bun.env.XDG_DATA_HOME;
    Bun.env.PI_CODING_AGENT_DIR = agentDir;
    delete Bun.env.XDG_DATA_HOME;
    clearSessionFileCaches();
  });

  afterAll(() => {
    if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
    else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
    if (previousXdg === undefined) delete Bun.env.XDG_DATA_HOME;
    else Bun.env.XDG_DATA_HOME = previousXdg;
    clearSessionFileCaches();
  });

  test('sessionNotFoundResponse is the shared 404 envelope', async () => {
    const response = sessionNotFoundResponse();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Session not found' });
  });

  test('resolveSessionFileOr404 returns the path for a known session', async () => {
    const file = writeSessionFile(join(sessionsRoot, 'proj-b', 'known.jsonl'), [header('known')]);
    clearSessionFileCaches();
    expect(await resolveSessionFileOr404('known')).toEqual({ filePath: file });
  });

  test('resolveSessionFileOr404 answers the 404 envelope for an unknown session', async () => {
    clearSessionFileCaches();
    const resolved = await resolveSessionFileOr404('missing-id');
    expect('response' in resolved).toBe(true);
    if ('response' in resolved) expect(resolved.response.status).toBe(404);
  });

  test('resolveSessionPathOr404 also reports the cwd recorded in the header', async () => {
    const file = writeSessionFile(join(sessionsRoot, 'proj-b', 'cwd.jsonl'), [
      header('cwd', { cwd: '/tmp/recorded-dir' }),
    ]);
    clearSessionFileCaches();
    expect(await resolveSessionPathOr404('cwd')).toEqual({ filePath: file, recordedCwd: '/tmp/recorded-dir' });
  });

  test('resolveSessionPathOr404 leaves recordedCwd null when the header has none', async () => {
    writeSessionFile(join(sessionsRoot, 'proj-b', 'nocwd.jsonl'), [
      { type: 'session', version: 3, id: 'nocwd' },
    ]);
    clearSessionFileCaches();
    expect(await resolveSessionPathOr404('nocwd')).toEqual({
      filePath: join(sessionsRoot, 'proj-b', 'nocwd.jsonl'),
      recordedCwd: null,
    });
  });
});

describe('scanSessionInfo', () => {
  test('maps a well-formed session file into its sidebar row', async () => {
    const file = writeSessionFile(join(tempDir('scan'), 'proj', 's.jsonl'), [
      header('scan-id', { title: 'Header title' }),
      userMessage('first user text', '2026-09-01T00:00:10.000Z'),
      { type: 'message', timestamp: '2026-09-01T00:00:20.000Z', message: { role: 'assistant', content: 'hi' } },
    ]);
    const info = await scanSessionInfo(file);
    expect(info?.id).toBe('scan-id');
    expect(info?.cwd).toBe('/tmp/proj');
    expect(info?.title).toBe('Header title');
    expect(info?.created.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(info?.modified.toISOString()).toBe('2026-09-01T00:00:20.000Z');
    expect(info?.messageCount).toBe(2);
    expect(info?.firstMessage).toBe('first user text');
    expect(info?.size).toBeGreaterThan(0);
  });

  test('a 256-byte title slot overrides the header title', async () => {
    const file = writeSessionFile(join(tempDir('scan'), 'proj', 's.jsonl'), [
      { type: 'title', v: 1, title: 'Slot title', updatedAt: '2026-09-01T00:00:00.000Z' },
      header('slot-id', { title: 'Header title' }),
    ]);
    expect((await scanSessionInfo(file))?.title).toBe('Slot title');
  });

  test('a compaction shortSummary supplies the title when none is set', async () => {
    const file = writeSessionFile(join(tempDir('scan'), 'proj', 's.jsonl'), [
      header('summary-id'),
      { type: 'compaction', timestamp: '2026-09-01T00:00:30.000Z', shortSummary: 'Summarized topic' },
    ]);
    expect((await scanSessionInfo(file))?.title).toBe('Summarized topic');
  });

  test('reports a placeholder when the session has no user message', async () => {
    const file = writeSessionFile(join(tempDir('scan'), 'proj', 's.jsonl'), [header('empty-id')]);
    expect((await scanSessionInfo(file))?.firstMessage).toBe('(no messages)');
  });

  test('a missing file yields undefined instead of throwing', async () => {
    expect(await scanSessionInfo(join(tempDir('scan'), 'gone.jsonl'))).toBeUndefined();
  });

  test('a file with no session header yields undefined', async () => {
    const file = writeSessionFile(join(tempDir('scan'), 'proj', 's.jsonl'), [userMessage('hi', '2026-09-01T00:00:10.000Z')]);
    expect(await scanSessionInfo(file)).toBeUndefined();
  });
});

describe('sessionHasSubagents', () => {
  test('a plain session with no sibling directory has no subagents', async () => {
    const file = writeSessionFile(join(tempDir('sub'), 'plain.jsonl'), [header('plain')]);
    expect(await sessionHasSubagents(file, '2026-09-01T00:00:00.000Z')).toBe(false);
  });

  test('a sibling artifacts directory holding a transcript reports subagents', async () => {
    const dir = tempDir('sub');
    const file = writeSessionFile(join(dir, 'parent.jsonl'), [header('parent')]);
    fs.mkdirSync(join(dir, 'parent'), { recursive: true });
    fs.writeFileSync(join(dir, 'parent', 'AlphaBeta.jsonl'), '');
    expect(await sessionHasSubagents(file, '2026-09-01T00:00:00.000Z')).toBe(true);
  });

  test('a parent task toolResult with subagent progress reports subagents', async () => {
    const file = writeSessionFile(join(tempDir('sub'), 'roster.jsonl'), [
      header('roster'),
      {
        type: 'message',
        timestamp: '2026-09-01T00:00:10.000Z',
        message: {
          role: 'toolResult',
          toolName: 'task',
          details: { progress: [{ id: 'AlphaBeta', agent: 'task', status: 'running' }] },
        },
      },
    ]);
    expect(await sessionHasSubagents(file, '2026-09-01T00:00:00.000Z')).toBe(true);
  });

  test('removing the sibling directory invalidates a cached true', async () => {
    const dir = tempDir('sub');
    const file = writeSessionFile(join(dir, 'parent.jsonl'), [header('parent')]);
    const sibling = join(dir, 'parent');
    fs.mkdirSync(sibling, { recursive: true });
    fs.writeFileSync(join(sibling, 'AlphaBeta.jsonl'), '');
    expect(await sessionHasSubagents(file, '2026-09-01T00:00:00.000Z')).toBe(true);
    // Same last-entry timestamp, but the sibling dir is gone: the version
    // changed, so the cached answer must not survive.
    fs.rmSync(sibling, { recursive: true, force: true });
    expect(await sessionHasSubagents(file, '2026-09-01T00:00:00.000Z')).toBe(false);
  });
});
