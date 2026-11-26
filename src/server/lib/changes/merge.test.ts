/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A session that spans the feature: it ran before the Kabmo journal existed and
 * continued after it.
 *
 * The Kabmo journal starts mid-session, so the omp records older than its first
 * line are merged in. A diff whose two sides straddle the boundary must read
 * the omp blob for the `before` and the Kabmo blob for the `after` — the two
 * stores are separate directories.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { ChangeJournal } from '@/server/lib/changes/journal.server';
import {
  readSessionChangeDiff,
  readSessionChangeList,
} from '@/server/lib/changes/reader.server';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';

const SESSION = 'merge-1';
const CWD = '/repo';
let dataDir = '';
let agentDir = '';
let ompJournalDir = '';
let originalData: string | undefined;
let originalAgent: string | undefined;

async function ompBlob(key: string, text: string): Promise<void> {
  await fsp.mkdir(path.join(ompJournalDir, 'blobs'), { recursive: true });
  await fsp.writeFile(path.join(ompJournalDir, 'blobs', key), Bun.gzipSync(Buffer.from(text, 'utf8')));
}

async function ompChange(record: Record<string, unknown>): Promise<void> {
  await fsp.appendFile(path.join(ompJournalDir, 'changes.jsonl'), `${JSON.stringify(record)}\n`);
}

beforeAll(async () => {
  originalData = Bun.env.KABMO_DATA_DIR;
  originalAgent = Bun.env.PI_CODING_AGENT_DIR;
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-merge-data-'));
  agentDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'kabmo-merge-agent-'));
  Bun.env.KABMO_DATA_DIR = dataDir;
  Bun.env.PI_CODING_AGENT_DIR = agentDir;
  clearSessionFileCaches();

  const projectDir = path.join(agentDir, 'sessions', '-repo');
  await fsp.mkdir(projectDir, { recursive: true });
  const sessionFile = path.join(projectDir, `2026-01-01T00-00-00-000Z_${SESSION}.jsonl`);
  await fsp.writeFile(
    sessionFile,
    `${JSON.stringify({ type: 'session', version: 3, id: SESSION, timestamp: '2026-01-01T00:00:00.000Z', cwd: CWD })}\n`,
  );
  ompJournalDir = sessionFile.slice(0, -'.jsonl'.length);
  await fsp.mkdir(ompJournalDir, { recursive: true });

  // The pre-feature half: an omp create and an omp update.
  await ompBlob('omp-a', 'A');
  await ompBlob('omp-b1', 'B1');
  await ompBlob('omp-b2', 'B2');
  await ompChange({ type: 'change', at: 100, agent: 'Main', tool: 'edit', path: '/repo/a.ts', before: null, after: 'omp-a' });
  await ompChange({ type: 'change', at: 110, agent: 'Main', tool: 'edit', path: '/repo/b.ts', before: 'omp-b1', after: 'omp-b2' });
  // After the first Kabmo line: must NOT be merged.
  await ompChange({ type: 'change', at: 300, agent: 'Main', tool: 'edit', path: '/repo/d.ts', before: null, after: 'omp-a' });
  // A pre-feature creation whose file is gone: the omp heuristic drops it.
  await ompChange({ type: 'change', at: 120, agent: 'Main', tool: 'edit', path: '/repo/e.ts', before: null, after: 'omp-a' });

  // The post-feature half: a Kabmo update of a.ts and b.ts, plus a new c.ts.
  const journal = new ChangeJournal(SESSION, CWD);
  await journal.recordChange({
    at: 200, agent: 'Main', tool: 'bash', op: 'update', path: '/repo/a.ts',
    displayPath: 'a.ts', before: 'A', after: 'A2', source: 'trace', command: 'sed -i s/A/A2/ a.ts',
  });
  await journal.recordChange({
    at: 210, agent: 'Main', tool: 'bash', op: 'update', path: '/repo/b.ts',
    displayPath: 'b.ts', before: 'B2', after: 'B3', source: 'trace', command: 'sed -i s/B2/B3/ b.ts',
  });
  await journal.recordChange({
    at: 220, agent: 'Main', tool: 'write', op: 'create', path: '/repo/c.ts',
    displayPath: 'c.ts', before: null, after: 'C', source: 'tool',
  });
  await journal.flush();
});

afterAll(async () => {
  if (originalData === undefined) delete Bun.env.KABMO_DATA_DIR;
  else Bun.env.KABMO_DATA_DIR = originalData;
  if (originalAgent === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = originalAgent;
  clearSessionFileCaches();
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(agentDir, { recursive: true, force: true });
});

describe('a session that spans the feature', () => {
  test('merges the omp records older than the first Kabmo line', async () => {
    const records = await readSessionChangeList(SESSION);
    expect(records.map((record) => record.path)).toEqual([
      '/repo/a.ts',
      '/repo/b.ts',
      '/repo/a.ts',
      '/repo/b.ts',
      '/repo/c.ts',
    ]);
    // The omp record after the boundary is not merged.
    expect(records.some((record) => record.path === '/repo/d.ts')).toBe(false);
    // A pre-feature creation whose file is gone is dropped by the omp heuristic.
    expect(records.some((record) => record.path === '/repo/e.ts')).toBe(false);
  });

  test('a diff straddling the boundary reads each side from its own store', async () => {
    const diff = await readSessionChangeDiff(SESSION, '/repo/b.ts', 0, 1000);
    expect(diff?.status).toBe('modified');
    expect(diff?.oldContent).toBe('B1');
    expect(diff?.newContent).toBe('B3');
    expect(diff?.unavailable).toBe(false);
  });

  test('a create before the boundary and an update after it is one added file', async () => {
    const diff = await readSessionChangeDiff(SESSION, '/repo/a.ts', 0, 1000);
    expect(diff?.status).toBe('added');
    expect(diff?.oldContent).toBe('');
    expect(diff?.newContent).toBe('A2');
  });

  test('a Kabmo-only path reads the Kabmo store', async () => {
    const diff = await readSessionChangeDiff(SESSION, '/repo/c.ts', 0, 1000);
    expect(diff?.status).toBe('added');
    expect(diff?.newContent).toBe('C');
  });
});
