/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The grouping rule the quota section renders.
 *
 * Three shapes, three bugs prevented:
 *  - Claude's USD spend limit (`anthropic:extra`) must NOT sit in the same grid
 *    as its 5h/7d windows; it is a balance after the windows, not a window.
 *  - Antigravity's `anthropic:` and `openai:` rows are ONE upstream bucket
 *    ("Claude & GPT (shared)"), so they must land in one group rather than two
 *    headings repeating the same sentence.
 *  - Every other provider is a single group, and a row's order inside it is
 *    omp's own (sorted by remaining fraction) — regrouping must not reshuffle.
 */

import { describe, expect, test } from 'bun:test';
import { groupProviderLimits } from '@/client/components/settings/categories/usage-settings/limit-groups';
import type { UsageLimitWindow } from '@/shared/types';

const limit = (id: string, overrides: Partial<UsageLimitWindow> = {}): UsageLimitWindow => ({
  id,
  label: id,
  unit: 'percent',
  status: 'ok',
  ...overrides,
});

describe('groupProviderLimits', () => {
  test('an ordinary provider is one group, in source order', () => {
    const limits = [limit('openrouter:credits'), limit('openrouter:daily')];
    const groups = groupProviderLimits('openrouter', limits);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Quota windows');
    expect(groups[0]?.limits.map((row) => row.id)).toEqual(['openrouter:credits', 'openrouter:daily']);
  });

  test('Claude keeps its plan windows together and puts the spend limit under Balance', () => {
    const limits = [
      limit('anthropic:5h'),
      limit('anthropic:7d'),
      limit('anthropic:7d:opus'),
      limit('anthropic:extra', { unit: 'usd', label: 'Claude Extra Usage' }),
    ];
    const groups = groupProviderLimits('anthropic', limits);
    expect(groups.map((group) => group.title)).toEqual(['Quota windows', 'Balance']);
    expect(groups[0]?.limits.map((row) => row.id)).toEqual(['anthropic:5h', 'anthropic:7d', 'anthropic:7d:opus']);
    expect(groups[1]?.limits.map((row) => row.id)).toEqual(['anthropic:extra']);
  });

  test('Claude without a spend limit renders one section, not an empty Balance', () => {
    const groups = groupProviderLimits('anthropic', [limit('anthropic:5h')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('Quota windows');
  });

  test('Antigravity merges the shared Anthropic/OpenAI bucket and keeps Google apart', () => {
    const limits = [
      limit('google-antigravity:google:default:weekly'),
      limit('google-antigravity:anthropic:default:5h'),
      limit('google-antigravity:openai:default:5h'),
      limit('google-antigravity:default:default:daily'),
    ];
    const groups = groupProviderLimits('google-antigravity', limits);
    expect(groups.map((group) => group.title)).toEqual(['Google', 'Claude & GPT (shared)', 'Usage']);
    expect(groups[1]?.limits.map((row) => row.id)).toEqual([
      'google-antigravity:anthropic:default:5h',
      'google-antigravity:openai:default:5h',
    ]);
  });

  test('Antigravity emits one row for the shared bucket even though omp names two families', () => {
    const shared = { label: 'Claude & GPT (shared)', usedFraction: 0.71, remaining: 29, resetsAt: 1_800 };
    const groups = groupProviderLimits('google-antigravity', [
      limit('google-antigravity:anthropic:default:5h', shared),
      limit('google-antigravity:openai:default:5h', shared),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.limits).toHaveLength(1);
  });

  test('an unknown Antigravity counter is shown under its own name, never dropped', () => {
    const groups = groupProviderLimits('google-antigravity', [limit('google-antigravity:mistral:default:weekly')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.title).toBe('mistral');
    expect(groups[0]?.limits).toHaveLength(1);
  });

  test('no limits means no groups, so the caller draws its empty state', () => {
    expect(groupProviderLimits('anthropic', [])).toEqual([]);
  });
});
