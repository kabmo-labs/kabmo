/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The failure a session's own transcript records, for the one harness whose
 * envelope cannot say it.
 *
 * Measured on a real `omp-acp` spawn: the agent answered a provider failure as
 * ordinary assistant text and ended the turn normally, so the ACP envelope said
 * `end_turn` while omp's JSONL for the same turn carried `stopReason: "error"`
 * and the provider's message. Reading only the envelope reported a delegated
 * worker as `completed` and handed its coordinator the error as if it were a
 * report.
 *
 * The rules pinned here are the ones that keep the read honest: only a harness
 * whose transcript Kabmo can read is consulted, the LAST assistant record
 * decides (a retried attempt must not speak for the turn), and an unreadable
 * file is not evidence of a failure.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { transcriptFailure } from '@/server/lib/harness/acp/turn-outcome.server';
import { clearSessionFileCaches } from '@kabmo-labs/kabmo-omp-session-scan/files';
import { removeDir } from '@/test-support/remove-dir';

const ROOT = mkdtempSync(join(tmpdir(), 'kabmo-turn-outcome-'));
const SESSIONS = join(ROOT, 'sessions', 'proj');
const previousAgentDir = Bun.env.PI_CODING_AGENT_DIR;

function writeSession(id: string, records: Record<string, unknown>[]): void {
  writeFileSync(
    join(SESSIONS, `2026-11-18T00-00-00-000Z_${id}.jsonl`),
    records.map((record) => JSON.stringify(record)).join('\n'),
  );
}

const header = (id: string) => ({ type: 'session', id, cwd: '/tmp', timestamp: '2026-11-18T00:00:00.000Z' });
const assistant = (extra: Record<string, unknown>) => ({
  type: 'message',
  message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }], ...extra },
});

beforeAll(() => {
  mkdirSync(SESSIONS, { recursive: true });
  Bun.env.PI_CODING_AGENT_DIR = ROOT;
  clearSessionFileCaches();
});

afterAll(() => {
  if (previousAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = previousAgentDir;
  clearSessionFileCaches();
  removeDir(ROOT);
});

describe('transcriptFailure', () => {
  test('reads the provider reason omp recorded for the last turn', async () => {
    writeSession('failed-1', [
      header('failed-1'),
      assistant({ stopReason: 'error', errorMessage: '400 The model is unavailable' }),
    ]);
    clearSessionFileCaches();

    expect(await transcriptFailure('omp-acp', 'failed-1')).toBe('400 The model is unavailable');
  });

  test('a normal last turn answers null, even after an earlier failure', async () => {
    writeSession('recovered-1', [
      header('recovered-1'),
      assistant({ stopReason: 'error', errorMessage: '429 rate limited' }),
      assistant({ stopReason: 'stop' }),
    ]);
    clearSessionFileCaches();

    expect(await transcriptFailure('omp-acp', 'recovered-1')).toBeNull();
  });

  test('a harness whose transcript Kabmo cannot read is never consulted', async () => {
    writeSession('claude-1', [
      header('claude-1'),
      assistant({ stopReason: 'error', errorMessage: 'should not be read' }),
    ]);
    clearSessionFileCaches();

    expect(await transcriptFailure('claude', 'claude-1')).toBeNull();
  });

  test('a missing session is not a failure', async () => {
    expect(await transcriptFailure('omp-acp', 'never-existed')).toBeNull();
  });
});
