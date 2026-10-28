/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `UsageReport` both read paths answer with: `GET /api/settings/usage` and
 * the realtime `usage` topic.
 *
 * One builder, because the two must never disagree. The right panel renders
 * whichever arrived first (`usage.data ?? fetched`), so a topic payload shaped
 * differently from the HTTP body is not a stale reading — it is a crash: the
 * topic used to resolve the provider ROWS while both consumers expect the
 * report envelope, so `report.providers.map` ran on `undefined`.
 *
 * The demo report lives here rather than in the route for the reason
 * `omp/session/data-mock.ts` documents: under MOCK the panel reads the TOPIC,
 * so a demo reachable only over HTTP would leave the view empty (and, before
 * the shape was unified, crash it outright).
 */

import { isMockMode } from '@/server/mock.server';
import { buildUsageProviders } from '@/server/lib/usage/providers.server';
import type { UsageProviderSummary, UsageReport } from '@/shared/types';

/**
 * Build the report. `force` bypasses the provider-quota cache (the user's own
 * Refresh button: each read calls every provider's endpoint).
 */
export async function buildUsageReport(options: { force?: boolean } = {}): Promise<UsageReport> {
  if (isMockMode()) return mockUsageReport();
  return {
    isMock: false,
    generatedAt: new Date().toISOString(),
    providers: await buildUsageProviders({ force: options.force }),
  };
}

/** Deterministic demo report so the Usage surfaces render under MOCK=true. */
export function mockUsageReport(): UsageReport {
  const providers: UsageProviderSummary[] = [
    {
      id: 'kenari',
      name: 'Kenari.id',
      credentialSources: ['models.yml'],
      // kenari is a plain OpenAI-compatible gateway: omp ships no usage adapter.
      tracked: false,
      limits: [],
      kenari: {
        balance: { amountRp: 25_000, raw: 'Saldo: Rp 25.000' },
        usage: {
          rows: [
            { model: 'gemini-3-7-flash', requests: 37, inputTokens: 22255, outputTokens: 11487, costRp: 0 },
            { model: 'glm-5-3-flash', requests: 2122, inputTokens: 369435677, outputTokens: 914679, costRp: 0 },
          ],
          totalRequests: 5941,
          totalCostRp: 0,
          raw: 'Pemakaian 30 hari terakhir (biaya Rupiah).',
        },
        quota: {
          planName: 'Pro',
          windows: [
            { key: 'five_hour', label: '5 hours', usedRp: 0, remainingRp: 50_000, resetsAt: '2026-09-14T10:00:00.000Z' },
            { key: 'week', label: 'Weekly', usedRp: 12_500, remainingRp: 287_500, resetsAt: '2026-09-20T00:00:00.000Z' },
            { key: 'month', label: 'Monthly', usedRp: 120_000, remainingRp: 880_000, resetsAt: '2026-10-01T00:00:00.000Z' },
          ],
          coupon: null,
        },
      },
    },
    {
      id: 'deepseek',
      name: 'DeepSeek',
      credentialSources: ['agent.db'],
      tracked: false,
      limits: [],
      deepseek: {
        balance: {
          isAvailable: true,
          entries: [
            { currency: 'USD', totalBalance: '10.00', grantedBalance: '10.00', toppedUpBalance: '0.00' },
          ],
        },
      },
    },
    {
      id: 'anthropic',
      name: 'Anthropic (Claude Pro/Max)',
      credentialSources: ['agent.db'],
      tracked: true,
      limits: [
        {
          id: 'anthropic:5h',
          label: 'Claude 5 hour limit',
          windowLabel: '5h',
          used: 42,
          limit: 100,
          usedFraction: 0.42,
          unit: 'percent',
          status: 'ok',
          resetsAt: Date.now() + 3 * 60 * 60 * 1000,
        },
        {
          id: 'anthropic:7d',
          label: 'Claude weekly limit',
          windowLabel: '7d',
          used: 88,
          limit: 100,
          usedFraction: 0.88,
          unit: 'percent',
          status: 'warning',
          resetsAt: Date.now() + 4 * 24 * 60 * 60 * 1000,
        },
        {
          id: 'anthropic:fast',
          label: 'Fast requests',
          windowLabel: '24h',
          used: 320,
          limit: 500,
          usedFraction: 0.64,
          unit: 'requests',
          status: 'ok',
          resetsAt: Date.now() + 6 * 60 * 60 * 1000,
        },
      ],
    },
    {
      // A pay-as-you-go vendor: no omp adapter, only a credit balance.
      id: 'openrouter',
      name: 'OpenRouter',
      credentialSources: ['agent.db'],
      tracked: false,
      limits: [
        {
          id: 'openrouter:credits',
          label: 'Key credits',
          used: 25.5,
          limit: 100,
          remaining: 74.5,
          usedFraction: 0.255,
          unit: 'usd',
          status: 'ok',
        },
        {
          id: 'openrouter:daily',
          label: 'Spent today (monthly)',
          used: 1.82,
          unit: 'usd',
          status: 'unknown',
        },
      ],
    },
  ];

  return { isMock: true, generatedAt: new Date().toISOString(), providers };
}
