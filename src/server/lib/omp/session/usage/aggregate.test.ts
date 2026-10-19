/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The usage rollup behind `/api/telemetry/tokens` (`aggregate.ts`).
 *
 * The aggregator folds a whole sessions tree into one aggregate per window, so
 * every risk here is arithmetic or filtering: a record counted in the wrong
 * window, a missing `usage` field read as NaN instead of 0, an entry that
 * carries `usage` but is not a `message` inflating the totals, an explicit
 * `totalTokens` ignored in favour of a re-derived sum, or an explicit
 * `cost.total` overridden by its parts. Each case pins one of those with
 * exact values, because a wrong number only surfaces later as a user's bill
 * disagreeing with the panel. The shaping half moved to
 * `aggregate-shaping.test.ts` so both files stay under the 350-line ceiling.
 *
 * The aggregator keeps its transcript scan in a module-scope cache (60 s TTL)
 * that nothing can reset, and `bun test` shares one module registry across
 * files. A query-suffixed dynamic import therefore loads a PRIVATE instance
 * per scenario: the unreadable-root case cannot leak into the populated one,
 * and the instance other suites import is never called from here.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

import type { TimeRangeType } from '@/shared/types';
import { PRESET_RANGES, type UsageAggregate, type UsageWindow } from '@/server/lib/omp/session/usage/aggregate';


/** The slice of the aggregator these tests drive, typed without an inline import. */
interface AggregateModule {
  aggregateUsage(window: UsageWindow): Promise<UsageAggregate>;
  aggregateUsageWindows(window: UsageWindow): Promise<{
    ranges: Record<Exclude<TimeRangeType, 'custom'>, UsageAggregate>;
    active: UsageAggregate;
  }>;
}

const tempRoots: string[] = [];
let savedAgentDir: string | undefined;
let caseId = 0;

/** A private module instance — see the header for why one per scenario. */
async function loadAggregate(): Promise<AggregateModule> {
  // Built at runtime so TypeScript never tries to resolve the query suffix.
  const specifier = `./aggregate.ts?case=${caseId++}`;
  return (await import(specifier)) as AggregateModule;
}

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kabmo-test-'));
  tempRoots.push(root);
  return root;
}

/** Point `getSessionsDir()` at `<root>/agent/sessions`. */
function useAgentDir(root: string): string {
  const agent = path.join(root, 'agent');
  process.env.PI_CODING_AGENT_DIR = agent;
  return path.join(agent, 'sessions');
}

function writeSession(sessionsRoot: string, project: string, file: string, lines: Array<unknown | string>): void {
  const target = path.join(sessionsRoot, project, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n');
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** `YYYY-MM-DD` of an instant in LOCAL time — the frame a custom range parses in. */
function localDay(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

let now = 0;
let todayIso = '';
let threeDaysIso = '';
let tenDaysIso = '';
/** The populated tree, scanned by private instances of the module. */
let populatedRoot = '';
/** The temp root `useAgentDir` takes — it appends `agent` itself, so passing
 *  the sessions dir back in would look for `<tmp>/agent/agent`. */
let populatedRootBase = '';

function message(id: string, timestamp: string, model: string, usage: Record<string, unknown>): unknown {
  return {
    type: 'message',
    id,
    timestamp,
    message: { role: 'assistant', model, content: [{ type: 'text', text: 'answer' }], usage },
  };
}

beforeAll(() => {
  savedAgentDir = process.env.PI_CODING_AGENT_DIR;
  now = Date.now();
  todayIso = new Date(now).toISOString();
  threeDaysIso = new Date(now - 3 * DAY_MS).toISOString();
  tenDaysIso = new Date(now - 10 * DAY_MS).toISOString();

  populatedRootBase = tempRoot();
  populatedRoot = useAgentDir(populatedRootBase);
  const header = (id: string) => ({ type: 'session', id, cwd: '/work/alpha', timestamp: todayIso });

  writeSession(populatedRoot, 'proj-alpha', 'a1.jsonl', [
    header('s-alpha-1'),
    // A user row with no usage, and an assistant row with none either:
    // neither can be folded, and neither may be counted as a record.
    { type: 'message', id: 'm-user', timestamp: todayIso, message: { role: 'user', content: 'hello' } },
    { type: 'message', id: 'm-asst', timestamp: todayIso, message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
    // Carries usage but is not a message entry: the filter must drop it.
    { type: 'custom', customType: 'tool_execution_start', timestamp: todayIso, message: { role: 'assistant', usage: { input: 999, output: 999, cost: { total: 9 } } } },
    // Explicit totalTokens, and a cost breakdown whose parts sum to `total`.
    message('m-1', todayIso, 'claude-x', {
      input: 100, output: 50, cacheRead: 200, cacheWrite: 10, reasoningTokens: 7, totalTokens: 360,
      cost: { input: 0.5, output: 0.25, cacheRead: 0.05, cacheWrite: 0.02, total: 0.82 },
    }),
    // No totalTokens (the derived sum is used) and no cache costs.
    message('m-2', threeDaysIso, 'gpt-y', { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0, cost: { input: 1, output: 0.5, total: 1.5 } }),
  ]);

  writeSession(populatedRoot, 'proj-alpha', 'a2.jsonl', [
    header('s-alpha-2'),
    message('m-3', tenDaysIso, 'claude-x', { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15, cost: { total: 0.03 } }),
    '{"type":"message","message":{"usage":{', // torn write: must not throw
    'note mentioning "usage" in tool output', // parses to nothing
    '{"type":"message","message":{"role":"assistant","content":"plain"}}', // no usage key at all
  ]);

  // Non-session files and a nested directory must not become transcripts.
  fs.writeFileSync(path.join(populatedRoot, 'notes.txt'), 'not a session\n');
  fs.writeFileSync(path.join(populatedRoot, 'proj-alpha', 'README.md'), 'not a session\n');
  fs.mkdirSync(path.join(populatedRoot, 'proj-alpha', 'nested'), { recursive: true });
});

afterAll(() => {
  if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

describe('aggregateUsage', () => {
  test('an unreadable sessions root yields the zero aggregate, not a throw', async () => {
    useAgentDir(tempRoot()); // no `agent/sessions` directory at all
    const { aggregateUsage } = await loadAggregate();
    const a = await aggregateUsage({ kind: 'all' });
    expect(a.scannedTranscripts).toBe(0);
    expect(a.usageRecords).toBe(0);
    expect(a.costTotal).toBe(0);
    expect(a.inputTokens + a.outputTokens + a.cacheReadTokens + a.cacheWriteTokens).toBe(0);
    expect(a.activeDays.size).toBe(0);
    expect([...a.byModel.keys()]).toEqual([]);
    expect([...a.byDay.keys()]).toEqual([]);
  });

  test('folds every usage record of the tree, with exact token and cost totals', async () => {
    useAgentDir(populatedRootBase);
    const { aggregateUsage } = await loadAggregate();
    const a = await aggregateUsage({ kind: 'all' });

    // Two .jsonl files; notes.txt, README.md and the nested dir are skipped.
    expect(a.scannedTranscripts).toBe(2);
    expect(a.usageRecords).toBe(3);
    expect(a.inputTokens).toBe(1110);
    expect(a.outputTokens).toBe(255);
    expect(a.cacheReadTokens).toBe(200);
    expect(a.cacheWriteTokens).toBe(10);
    expect(a.reasoningTokens).toBe(7);
    expect(a.costInput).toBeCloseTo(1.5, 10);
    expect(a.costOutput).toBeCloseTo(0.75, 10);
    expect(a.costCacheRead).toBeCloseTo(0.05, 10);
    expect(a.costCacheWrite).toBeCloseTo(0.02, 10);
    expect(a.costTotal).toBeCloseTo(2.35, 10);

    expect([...a.activeDays].sort()).toEqual([tenDaysIso, threeDaysIso, todayIso].map((iso) => iso.slice(0, 10)).sort());
    // byModel/byProject/byDay count `totalTokens`, with the derived fallback.
    expect(a.byModel.get('claude-x')).toEqual({ tokens: 375, cost: 0.85 });
    expect(a.byModel.get('gpt-y')).toEqual({ tokens: 1200, cost: 1.5 });
    const alpha = a.byProject.get('proj-alpha');
    expect(alpha?.tokens).toBe(1575);
    // 0.85 + 1.5 accumulates as binary floats (2.3499999999999996) — the
    // rollup sums what it read and does not round, so the exact literal would
    // pin an accident of float addition rather than the arithmetic.
    expect(alpha?.cost).toBeCloseTo(2.35, 10);
    expect(a.byDay.get(threeDaysIso.slice(0, 10))).toEqual({ tokens: 1200, cost: 1.5 });
  });

  test('windows exclude records outside their bounds', async () => {
    useAgentDir(populatedRootBase);
    const { aggregateUsage } = await loadAggregate();

    const today = await aggregateUsage({ kind: 'preset', range: 'today' });
    expect(today.usageRecords).toBe(1);
    expect(today.inputTokens).toBe(100);
    expect(today.costTotal).toBeCloseTo(0.82, 10);
    expect([...today.byModel.keys()]).toEqual(['claude-x']);

    const week = await aggregateUsage({ kind: 'preset', range: '7d' });
    expect(week.usageRecords).toBe(2);
    expect(week.inputTokens).toBe(1100);
    expect(week.outputTokens).toBe(250);
    expect(week.costTotal).toBeCloseTo(2.32, 10);

    // A single local calendar day, ten days back.
    const custom = await aggregateUsage({ kind: 'custom', from: localDay(now - 10 * DAY_MS), to: localDay(now - 10 * DAY_MS) });
    expect(custom.usageRecords).toBe(1);
    expect(custom.inputTokens).toBe(10);
    expect(custom.costTotal).toBeCloseTo(0.03, 10);
  });

  test('an unusable custom range falls back to unbounded rather than empty', async () => {
    useAgentDir(populatedRootBase);
    const { aggregateUsage } = await loadAggregate();
    expect((await aggregateUsage({ kind: 'custom', from: '2026-01-02', to: '2026-01-01' })).usageRecords).toBe(3);
    expect((await aggregateUsage({ kind: 'custom', from: 'not-a-date', to: '2026-01-01' })).usageRecords).toBe(3);
  });
});

describe('aggregateUsageWindows', () => {
  test('folds every preset plus the active window from one scan', async () => {
    useAgentDir(populatedRootBase);
    const { aggregateUsageWindows } = await loadAggregate();
    const { ranges, active } = await aggregateUsageWindows({ kind: 'custom', from: '1999-01-01', to: '1999-01-02' });

    // Every range the tokens endpoint reports, in display order.
    expect(PRESET_RANGES).toEqual(['today', '7d', '30d', '90d', 'all']);
    expect(Object.keys(ranges)).toEqual(['today', '7d', '30d', '90d', 'all']);
    expect(ranges.today.usageRecords).toBe(1);
    expect(ranges['7d'].usageRecords).toBe(2);
    expect(ranges['30d'].usageRecords).toBe(3);
    expect(ranges['90d'].usageRecords).toBe(3);
    expect(ranges.all.usageRecords).toBe(3);
    expect(active.usageRecords).toBe(0);
    for (const range of PRESET_RANGES) expect(ranges[range].scannedTranscripts).toBe(2);
  });
});
