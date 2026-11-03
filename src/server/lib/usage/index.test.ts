/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The Token Usage index end to end: an incremental scan over a real (temp)
 * sessions tree, and the payload arithmetic that used to run per request.
 *
 * The cases that matter are the ones a wrong index would silently corrupt:
 *
 *  - re-indexing an unchanged file must add NOTHING (a double-counted append is
 *    a doubled bill);
 *  - a truncated or rewritten transcript must REPLACE its contribution;
 *  - a removed transcript must stop contributing;
 *  - an undated record counts in every window;
 *  - two accounts serving one model id stay two rows.
 *
 * The line-level rules live in `index-parse.test.ts`. The DB is a temp file via
 * `isolateDb` and the sessions root a temp tree, so nothing here can reach the
 * developer's real `~/.kabmo` or `~/.omp`.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { removeDir } from '@/test-support/remove-dir';
import { getDb } from '@/server/db.server';
import { buildTokenUsagePayload } from '@/server/lib/usage/index-query.server';

const dirs: string[] = [];
let savedAgentDir: string | undefined;
let sessionsRoot = '';

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-usage-'));
  dirs.push(dir);
  return dir;
}

beforeAll(async () => {
  await isolateDb();
  savedAgentDir = Bun.env.PI_CODING_AGENT_DIR;
  const agent = path.join(tempDir(), 'agent');
  Bun.env.PI_CODING_AGENT_DIR = agent;
  sessionsRoot = path.join(agent, 'sessions');
  fs.mkdirSync(sessionsRoot, { recursive: true });
});

afterAll(async () => {
  if (savedAgentDir === undefined) delete Bun.env.PI_CODING_AGENT_DIR;
  else Bun.env.PI_CODING_AGENT_DIR = savedAgentDir;
  await releaseDb();
  for (const dir of dirs.splice(0)) removeDir(dir);
});

function messageLine(options: {
  timestamp?: string;
  provider?: string;
  model?: string;
  usage?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'message',
    timestamp: options.timestamp,
    message: {
      role: 'assistant',
      provider: options.provider,
      model: options.model,
      usage: options.usage ?? {},
    },
  });
}

function writeTranscript(file: string, lines: string[], project = 'proj'): string {
  const target = path.join(sessionsRoot, project, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.join('\n') + '\n');
  return target;
}

function appendTo(target: string, lines: string[]): void {
  fs.appendFileSync(target, lines.join('\n') + '\n');
}

function costed(options: {
  timestamp: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}): string {
  return messageLine({
    timestamp: options.timestamp,
    provider: options.provider,
    model: options.model,
    usage: {
      input: options.input,
      output: options.output,
      cacheRead: options.cacheRead,
      cacheWrite: 0,
      totalTokens: options.input + options.output + options.cacheRead,
      cost: { total: options.cost, input: options.cost / 2, output: options.cost / 4, cacheRead: options.cost / 4, cacheWrite: 0 },
    },
  });
}

describe('buildTokenUsagePayload', () => {
  const NOW = new Date(2026, 10, 3, 12, 0, 0).getTime();

  beforeAll(async () => {
    for (const entry of fs.readdirSync(sessionsRoot)) {
      removeDir(path.join(sessionsRoot, entry));
    }
    const db = await getDb();
    await db.exec('DELETE FROM usage_rollup; DELETE FROM usage_index_file; DELETE FROM usage_index_meta;');

    writeTranscript('a.jsonl', [
      costed({ timestamp: new Date(2026, 9, 10, 10, 0, 0).toISOString(), provider: 'kenari-jatis', model: 'deepseek-v4-1-flash', input: 100, output: 50, cacheRead: 1000, cost: 9 }),
      costed({ timestamp: new Date(2026, 9, 10, 11, 0, 0).toISOString(), provider: 'kenari-jatis', model: 'deepseek-v4-1-flash', input: 100, output: 50, cacheRead: 1000, cost: 9 }),
      costed({ timestamp: new Date(2026, 9, 20, 9, 0, 0).toISOString(), provider: 'kenari', model: 'deepseek-v4-1-flash', input: 10, output: 5, cacheRead: 100, cost: 1 }),
    ]);
    writeTranscript('b.jsonl', [
      costed({ timestamp: new Date(2026, 10, 2, 9, 0, 0).toISOString(), provider: 'deepseek', model: 'deepseek-flash', input: 4, output: 2, cacheRead: 40, cost: 0.5 }),
    ], 'other');
  });

  test('splits one model across the providers that served it', async () => {
    const payload = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true });
    const kenariJatis = payload.providers.find((provider) => provider.id === 'kenari-jatis');
    const kenari = payload.providers.find((provider) => provider.id === 'kenari');
    expect(kenariJatis?.cost).toBeCloseTo(18, 10);
    expect(kenariJatis?.records).toBe(2);
    expect(kenari?.cost).toBeCloseTo(1, 10);
    // Both report the same model id under their own provider.
    expect(kenariJatis?.models.map((model) => model.model)).toEqual(['deepseek-v4-1-flash']);
    expect(kenari?.models.map((model) => model.model)).toEqual(['deepseek-v4-1-flash']);
  });

  test('totals, active days and the period label describe the window', async () => {
    const payload = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true });
    expect(payload.totals.cost).toBeCloseTo(19.5, 10);
    expect(payload.totals.records).toBe(4);
    expect(payload.totals.activeDays).toBe(3);
    expect(payload.periodLabel).toBe('Oct 5 – Nov 3, 2026');
  });

  test('a narrower window drops the older records but keeps the same shape', async () => {
    const payload = await buildTokenUsagePayload({ range: '7d', now: NOW, wait: true });
    expect(payload.totals.records).toBe(1);
    expect(payload.providers.map((provider) => provider.id)).toEqual(['deepseek']);
    expect(payload.days.map((day) => day.day)).toEqual(['2026-11-02']);
  });

  test('the provider-split days carry the cost the stacked chart draws', async () => {
    const payload = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true });
    const day = payload.days.find((row) => row.day === '2026-10-10');
    expect(day?.cost).toBeCloseTo(18, 10);
    expect(day?.providers['kenari-jatis']?.cost).toBeCloseTo(18, 10);
    expect(Object.keys(day?.providers ?? {})).toEqual(['kenari-jatis']);
  });

  test('projects are attributed to the sessions folder the transcript lives in', async () => {
    const payload = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true });
    expect(payload.projects.map((row) => row.project).sort()).toEqual(['other', 'proj']);
  });

  test('an append is indexed without re-reading the whole file', async () => {
    const target = path.join(sessionsRoot, 'proj', 'a.jsonl');
    appendTo(target, [
      costed({ timestamp: new Date(2026, 10, 3, 9, 0, 0).toISOString(), provider: 'kenari-jatis', model: 'deepseek-v4-1-flash', input: 1, output: 1, cacheRead: 1, cost: 0.25 }),
    ]);
    const payload = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true, force: true });
    const provider = payload.providers.find((row) => row.id === 'kenari-jatis');
    expect(provider?.records).toBe(3);
    expect(provider?.cost).toBeCloseTo(18.25, 10);

    // Unchanged files add nothing on the next pass.
    const again = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true });
    expect(again.providers.find((row) => row.id === 'kenari-jatis')?.records).toBe(3);
  });

  test('a truncated transcript replaces its contribution instead of double-counting', async () => {
    const target = writeTranscript('c.jsonl', [
      costed({ timestamp: new Date(2026, 10, 1, 8, 0, 0).toISOString(), provider: 'sumopod', model: 'netra', input: 5, output: 5, cacheRead: 5, cost: 2 }),
      costed({ timestamp: new Date(2026, 10, 1, 9, 0, 0).toISOString(), provider: 'sumopod', model: 'netra', input: 5, output: 5, cacheRead: 5, cost: 2 }),
    ]);
    const before = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true, force: true });
    expect(before.providers.find((row) => row.id === 'sumopod')?.cost).toBeCloseTo(4, 10);

    // Rewrite with one entry: the old two must not linger.
    fs.writeFileSync(target, `${costed({ timestamp: new Date(2026, 10, 1, 8, 0, 0).toISOString(), provider: 'sumopod', model: 'netra', input: 5, output: 5, cacheRead: 5, cost: 2 })}\n`);
    const after = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true, force: true });
    expect(after.providers.find((row) => row.id === 'sumopod')?.cost).toBeCloseTo(2, 10);
  });

  test('a removed transcript stops contributing', async () => {
    const before = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true, force: true });
    expect(before.providers.some((row) => row.id === 'deepseek')).toBe(true);

    fs.rmSync(path.join(sessionsRoot, 'other', 'b.jsonl'));
    const after = await buildTokenUsagePayload({ range: '30d', now: NOW, wait: true, force: true });
    expect(after.providers.some((row) => row.id === 'deepseek')).toBe(false);
    // The index drops the file's rows too, not just its totals.
    const db = await getDb();
    const rows = await db.all<{ project: string }>('SELECT project FROM usage_rollup WHERE project = ?', ['other']);
    expect(rows).toEqual([]);
  });

  test('undated records stay in every window', async () => {
    writeTranscript('d.jsonl', [messageLine({ provider: 'kiosapi', model: 'm', usage: { input: 3, output: 1, cost: { total: 0.75 } } })]);
    const payload = await buildTokenUsagePayload({ range: 'today', now: NOW, wait: true, force: true });
    expect(payload.providers.find((row) => row.id === 'kiosapi')?.cost).toBeCloseTo(0.75, 10);
  });

  test('a custom period is inclusive of both endpoints', async () => {
    const payload = await buildTokenUsagePayload({
      range: 'custom',
      customFrom: '2026-10-10',
      customTo: '2026-10-10',
      now: NOW,
      wait: true,
    });
    // Two records on Oct 10, plus the undated one from the previous case: a
    // missing date is not evidence of age, so it counts in every window.
    expect(payload.totals.records).toBe(3);
    expect(payload.periodLabel).toBe('Oct 10, 2026');
  });
});
