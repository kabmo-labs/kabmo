/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Saved rate-limit resets: list them, and spend one.
 *
 * omp keeps provider-issued reset credits for Codex and Claude accounts
 * (18.9.0 added `omp usage reset`, and warns when one is nearing expiry). The
 * chamber's Usage surfaces showed only quota windows and balances, so a reset
 * the user had saved could be seen nowhere and spent nowhere — the one
 * action that clears an exhausted window was CLI-only.
 *
 * Both halves are omp's own command, never a re-implementation:
 *
 *   $ omp usage reset --json            # list every stored account's credits
 *   $ omp usage reset <provider>/<id>   # spend one
 *
 * A spend is a REAL, irreversible provider call, which is why the route is a
 * POST with an explicit target and why a failure keeps omp's own sentence
 * (it names the reason — already redeemed, nothing to reset, no such account —
 * none of which this side could reconstruct).
 */

import { resolveOmpBin } from '@/server/lib/omp/core/cli';
import { isMockMode } from '@/server/mock.server';
import { isRecord } from '@/shared/lib/util/guards';
import type { UsageResetAccount, UsageResetCredit, UsageResetList, UsageResetSpendResult } from '@/shared/types';

const LIST_TIMEOUT_MS = 30_000;
const SPEND_TIMEOUT_MS = 30_000;
const MAX_BUFFER_BYTES = 8 * 1024 * 1024;

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function parseCredit(raw: unknown): UsageResetCredit | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null;
  const clears = Array.isArray(raw.clears)
    ? raw.clears.filter((item): item is string => typeof item === 'string')
    : undefined;
  const usedFractions = Array.isArray(raw.usedFractions)
    ? raw.usedFractions.filter((item): item is number => typeof item === 'number')
    : undefined;
  return {
    id: raw.id,
    ...(toText(raw.title) ? { title: toText(raw.title) } : {}),
    ...(toText(raw.program) ? { program: toText(raw.program) } : {}),
    ...(toText(raw.status) ? { status: toText(raw.status) } : {}),
    ...(toNumber(raw.remainingCount) !== undefined ? { remainingCount: toNumber(raw.remainingCount) } : {}),
    ...(typeof raw.usable === 'boolean' ? { usable: raw.usable } : {}),
    ...(typeof raw.requiresLimit === 'boolean' ? { requiresLimit: raw.requiresLimit } : {}),
    ...(clears && clears.length > 0 ? { clears } : {}),
    ...(typeof raw.blocking === 'boolean' ? { blocking: raw.blocking } : {}),
    ...(usedFractions && usedFractions.length > 0 ? { usedFractions } : {}),
    ...(toNumber(raw.grantedAt) !== undefined ? { grantedAt: toNumber(raw.grantedAt) } : {}),
    ...(toNumber(raw.expiresAt) !== undefined ? { expiresAt: toNumber(raw.expiresAt) } : {}),
  };
}

/**
 * Parse `omp usage reset --json`. Every field is optional in omp's output, and
 * a row without a `credentialId` cannot be spent — the target grammar is
 * `<provider>/<credential id>` — so such a row is dropped rather than rendered
 * as an unusable button.
 */
export function parseUsageResetList(payload: unknown): UsageResetList {
  const generatedAt = isRecord(payload) ? toNumber(payload.generatedAt) ?? Date.now() : Date.now();
  const rows = isRecord(payload) && Array.isArray(payload.accounts) ? payload.accounts : [];
  const accounts: UsageResetAccount[] = [];
  for (const raw of rows) {
    if (!isRecord(raw)) continue;
    const provider = toText(raw.provider);
    const credentialId = toText(raw.credentialId);
    if (!provider || !credentialId) continue;
    const credits = Array.isArray(raw.credits)
      ? raw.credits.map(parseCredit).filter((credit): credit is UsageResetCredit => credit !== null)
      : [];
    accounts.push({
      provider,
      credentialId,
      ...(toText(raw.email) ? { email: toText(raw.email) } : {}),
      ...(toText(raw.accountId) ? { accountId: toText(raw.accountId) } : {}),
      ...(toText(raw.orgId) ? { orgId: toText(raw.orgId) } : {}),
      ...(toText(raw.orgName) ? { orgName: toText(raw.orgName) } : {}),
      ...(toNumber(raw.availableCount) !== undefined ? { availableCount: toNumber(raw.availableCount) } : {}),
      ...(toNumber(raw.redeemableCount) !== undefined ? { redeemableCount: toNumber(raw.redeemableCount) } : {}),
      ...(toText(raw.nextCreditId) ? { nextCreditId: toText(raw.nextCreditId) } : {}),
      ...(toNumber(raw.soonestExpiry) !== undefined ? { soonestExpiry: toNumber(raw.soonestExpiry) } : {}),
      ...(toText(raw.unavailableReason) ? { unavailableReason: toText(raw.unavailableReason) } : {}),
      ...(toText(raw.error) ? { error: toText(raw.error) } : {}),
      credits,
    });
  }
  return { generatedAt, accounts };
}

/** Run one `omp usage …` invocation. Never throws for a non-zero exit. */
async function runUsageCli(args: string[], timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const bin = resolveOmpBin();
  if (!bin) return { ok: false, stdout: '', stderr: 'omp binary not found' };
  try {
    const proc = Bun.spawn({
      cmd: [bin, 'usage', ...args],
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: timeoutMs,
      maxBuffer: MAX_BUFFER_BYTES,
      windowsHide: true,
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { ok: exitCode === 0, stdout, stderr };
  } catch (error) {
    return { ok: false, stdout: '', stderr: error instanceof Error ? error.message : String(error) };
  }
}

/** The first non-empty line of a stream, without omp's status glyph. */
function firstLine(text: string): string {
  const raw = text.trim();
  const line = raw.split('\n').map((row) => row.trim()).find(Boolean) ?? '';
  return line.replace(/^[^\w@/]*/, '').trim();
}

/**
 * List every stored account's saved resets. A failure is REPORTED rather than
 * rendered as "no resets": omp exits 1 with `No Codex or Claude accounts
 * found…` when there is nothing to list, and an empty list and a failed read
 * look identical on screen while only one of them is actionable.
 */
export async function listUsageResets(): Promise<UsageResetList> {
  if (isMockMode()) return mockUsageResetList();
  const result = await runUsageCli(['reset', '--json'], LIST_TIMEOUT_MS);
  if (!result.ok) {
    throw new Error(firstLine(result.stderr) || firstLine(result.stdout) || 'omp usage reset failed');
  }
  try {
    return parseUsageResetList(JSON.parse(result.stdout));
  } catch {
    throw new Error('omp usage reset returned unexpected JSON');
  }
}

/**
 * Spend one saved reset on `<provider>/<credentialId>`.
 *
 * omp reports the outcome as a sentence on stdout on success and on stderr on
 * failure, so both are returned verbatim: the sentence IS the result, and a
 * bare `ok:false` would drop the reason ("that reset was already redeemed",
 * "nothing to reset right now") that tells the user whether to retry.
 */
export async function spendUsageReset(target: string): Promise<UsageResetSpendResult> {
  if (isMockMode()) return { ok: false, message: 'Saved resets are unavailable in demo mode.' };
  const result = await runUsageCli(['reset', target], SPEND_TIMEOUT_MS);
  const message = firstLine(result.ok ? result.stdout : result.stderr) || firstLine(result.stdout);
  return { ok: result.ok, message: message || 'omp usage reset produced no result' };
}

/** Deterministic demo list so the section renders under MOCK=true. */
export function mockUsageResetList(): UsageResetList {
  return {
    generatedAt: Date.now(),
    accounts: [
      {
        provider: 'openai-codex',
        credentialId: 'demo-codex-1',
        email: 'demo@example.com',
        availableCount: 2,
        redeemableCount: 1,
        nextCreditId: 'credit-demo-1',
        soonestExpiry: Date.now() + 3 * 24 * 60 * 60 * 1000,
        credits: [
          {
            id: 'credit-demo-1',
            title: 'Rate-limit reset',
            status: 'available',
            remainingCount: 1,
            usable: true,
            clears: ['openai-codex:5h'],
          },
        ],
      },
      {
        provider: 'anthropic',
        credentialId: 'demo-claude-1',
        email: 'demo@example.com',
        availableCount: 1,
        redeemableCount: 0,
        unavailableReason: 'the provider did not identify a grant that can be safely spent',
        credits: [{ id: 'credit-demo-2', title: 'Weekly limit reset', status: 'available', remainingCount: 1 }],
      },
    ],
  };
}
