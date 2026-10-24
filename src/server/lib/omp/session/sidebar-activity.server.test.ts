/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The `sidebar:activity` resolver, against a real sessions directory.
 *
 * The rules under test are the ones that keep this payload small enough to be
 * republished per tool call:
 *
 *   - it carries ONLY sessions with a run in flight — every other row keeps the
 *     stamp the structure gave it, which is why the structure does not have to
 *     be re-scanned;
 *   - a live run with no transcript yet contributes nothing (a fresh spawn:
 *     omp writes the file only when the first assistant message settles);
 *   - the stamp it reports is the newest ENTRY's timestamp, the same quantity
 *     the structure ships as `updated_at`, so the client can compare them;
 *   - the subagent flag is reported alongside, because a subagent's transcript
 *     appears mid-run and lights the parent row's roster chevron.
 *
 * Driven through `localRuns()` rather than a stubbed registry: that set is the
 * real "a run is in flight" source (the mock SSE stream uses it too), so the
 * test exercises the same read `loadSidebarStatus` does.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import * as path from 'path';

import { loadSidebarActivity } from '@/server/lib/omp/session/sidebar-activity.server';
import { localRuns } from '@/server/lib/omp/session/local-runs.server';
import { clearSessionFileCaches } from '@/server/lib/omp/session/files';
import { SESSION_TITLE_SLOT_BYTES } from '@/server/lib/omp/session/files';

const tempDirs: string[] = [];
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;

/**
 * Point the agent dir at a scratch tree, because `findSessionFileById` resolves
 * through the real sessions root. `PI_CODING_AGENT_DIR` is read per call, so no
 * module reload is needed — but the file caches are process-wide and keyed by
 * path, so they are cleared before and after.
 */
function useAgentDir(): string {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync('/tmp'), 'kabmo-activity-'));
  tempDirs.push(dir);
  process.env.PI_CODING_AGENT_DIR = dir;
  clearSessionFileCaches();
  return dir;
}

/** A title slot line, exactly as omp writes it, so the scan reads a real file. */
function titleSlot(title: string): string {
  const raw = JSON.stringify({ type: 'title', title });
  return raw + ' '.repeat(Math.max(0, SESSION_TITLE_SLOT_BYTES - 1 - raw.length));
}

interface SessionFixture {
  id: string;
  entries?: Array<{ type: string; timestamp?: string }>;
  subagents?: string[];
}

/**
 * Write one session file under `<agentDir>/sessions/<project>/`.
 *
 * The entries are minimal but carry the field the scan dates the file by (the
 * newest entry's own `timestamp`), which is the whole quantity under test.
 */
function writeSession(agentDir: string, fixture: SessionFixture): string {
  const projectDir = path.join(agentDir, 'sessions', '-tmp-project');
  fs.mkdirSync(projectDir, { recursive: true });
  const file = path.join(projectDir, `2026-10-24T00-00-00-000Z_${fixture.id}.jsonl`);
  const lines = [
    titleSlot(`Session ${fixture.id}`),
    JSON.stringify({ type: 'session', id: fixture.id, cwd: '/tmp/project', timestamp: '2026-10-24T00:00:00.000Z' }),
    ...(fixture.entries ?? []).map((entry) => JSON.stringify(entry)),
  ];
  fs.writeFileSync(file, `${lines.join('\n')}\n`);

  if (fixture.subagents?.length) {
    // A sibling directory named after the session file, holding one .jsonl per
    // subagent — the shape `sessionHasSubagents` reads.
    const sibling = file.replace(/\.jsonl$/, '');
    fs.mkdirSync(sibling, { recursive: true });
    for (const id of fixture.subagents) {
      fs.writeFileSync(path.join(sibling, `${id}.jsonl`), `${JSON.stringify({ type: 'message' })}\n`);
    }
  }
  clearSessionFileCaches();
  return file;
}

afterEach(() => {
  localRuns().clear();
  clearSessionFileCaches();
});

afterAll(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadSidebarActivity', () => {
  test('carries nothing when no run is in flight', async () => {
    const agentDir = useAgentDir();
    writeSession(agentDir, { id: 'idle', entries: [{ type: 'message', timestamp: '2026-10-24T01:00:00.000Z' }] });
    expect(await loadSidebarActivity()).toEqual({});
  });

  test('reports the newest entry timestamp of a session with a live run', async () => {
    const agentDir = useAgentDir();
    writeSession(agentDir, {
      id: 'live',
      entries: [
        { type: 'message', timestamp: '2026-10-24T01:00:00.000Z' },
        { type: 'message', timestamp: '2026-10-24T01:05:00.000Z' },
      ],
    });
    localRuns().add('live');

    const activity = await loadSidebarActivity();
    expect(Object.keys(activity)).toEqual(['live']);
    expect(activity.live?.updatedAt).toBe('2026-10-24T01:05:00.000Z');
  });

  test('never reports a session without a run, however recent its transcript', async () => {
    const agentDir = useAgentDir();
    writeSession(agentDir, { id: 'other', entries: [{ type: 'message', timestamp: '2026-10-24T01:00:00.000Z' }] });
    writeSession(agentDir, { id: 'live', entries: [{ type: 'message', timestamp: '2026-10-24T01:00:00.000Z' }] });
    localRuns().add('live');

    expect(Object.keys(await loadSidebarActivity())).toEqual(['live']);
  });

  test('omits a live run whose transcript does not exist yet', async () => {
    // A fresh spawn: omp writes the session file only when the first assistant
    // message settles, so there is no stamp to report. Its row is the client's
    // pending row until the scan finds the file.
    useAgentDir();
    localRuns().add('not-written-yet');
    expect(await loadSidebarActivity()).toEqual({});
  });

  test('reports the subagent flag, which moves mid-run', async () => {
    const agentDir = useAgentDir();
    writeSession(agentDir, {
      id: 'with-sub',
      entries: [{ type: 'message', timestamp: '2026-10-24T01:00:00.000Z' }],
      subagents: ['Sleeper'],
    });
    writeSession(agentDir, { id: 'plain', entries: [{ type: 'message', timestamp: '2026-10-24T01:00:00.000Z' }] });
    localRuns().add('with-sub');
    localRuns().add('plain');

    const activity = await loadSidebarActivity();
    expect(activity['with-sub']?.hasSubagents).toBe(true);
    expect(activity.plain?.hasSubagents).toBe(false);
  });
});
