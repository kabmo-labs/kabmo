/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell-release answer cache, and where the GitHub reads go.
 *
 * Split from `shell-release.ts` for two reasons that are not cosmetic.
 *
 * 1. **The key is per SHELL AND per ARCHITECTURE.** A desktop shell asks for the
 *    artifact of its own machine, so a single per-kind slot would answer an
 *    arm64 window with the x64 installer the moment both hit one console — and
 *    the console is routinely shared by a whole team.
 * 2. **The cache outlives a test file.** It lives on `globalThis` so `bun --hot`
 *    cannot orphan it, which is also why `resetShellReleaseCache` exists: without
 *    that seam the second case in a suite reads the first case's answer and
 *    passes for the wrong reason (measured — the "malformed body" case returned
 *    the previous test's release).
 */

import type { ShellArch } from '@/shared/lib/updates/shell-arch';
import type { ShellKind } from '@/shared/lib/updates/shell-ua';

/** How long an answer is reused. */
export const CACHE_MS = 5 * 60_000;

/** One shell's (and, for a desktop, one architecture's) cached answer. */
export interface CacheSlot<T> {
  entry: T | null;
  at: number;
}

type ShellCacheHost = typeof globalThis & {
  __kabmoShellRelease?: Record<string, CacheSlot<unknown>>;
};

/**
 * The cache key for one question.
 *
 * The arch is part of the KEY rather than a field on the value, so a stale entry
 * can never be read by the wrong machine: a miss is a miss, and there is no
 * comparison left to get wrong.
 */
export function shellCacheKey(kind: ShellKind, arch: ShellArch | null): string {
  return arch ? `${kind}:${arch}` : kind;
}

/** The cache slot for one key, created on first use. */
export function cacheSlot<T>(key: string): CacheSlot<T> {
  const host = globalThis as ShellCacheHost;
  host.__kabmoShellRelease ??= {};
  host.__kabmoShellRelease[key] ??= { entry: null, at: 0 };
  return host.__kabmoShellRelease[key] as CacheSlot<T>;
}

/**
 * Drop the cached answer for one shell (or every shell, with no argument).
 *
 * Production has no caller; it is the test seam described above.
 */
export function resetShellReleaseCache(kind?: ShellKind): void {
  const host = globalThis as ShellCacheHost;
  if (!kind) {
    host.__kabmoShellRelease = {};
    return;
  }
  const prefix = `${kind}:`;
  const slots = host.__kabmoShellRelease ?? {};
  for (const key of Object.keys(slots)) {
    if (key === kind || key.startsWith(prefix)) delete slots[key];
  }
}

/**
 * Where the release read goes.
 *
 * Overridable for the same reason the npm probe honours `NPM_CONFIG_REGISTRY`: a
 * test and a rehearsal need to exercise the real parsing against a stub instead
 * of a live GitHub call, and hardcoding the host makes that impossible without
 * intercepting `fetch` globally.
 */
export function githubApiBase(): string {
  const configured = Bun.env.KABMO_GITHUB_API ?? '';
  return configured.trim().replace(/\/+$/, '') || 'https://api.github.com';
}

/**
 * A token, when the operator has one, which lifts the API quota from 60 an hour
 * to 5000 — the difference between the precise read working on a shared address
 * and falling through to the pages every time.
 *
 * Read from the environment rather than a setting: it is a deployment fact, it
 * must never reach the browser, and `kabmo serve` already passes its own
 * environment through.
 */
export function gitHubHeaders(): Record<string, string> {
  const token = (Bun.env.KABMO_GITHUB_TOKEN ?? Bun.env.GITHUB_TOKEN ?? '').trim();
  const headers: Record<string, string> = {
    // GitHub rejects a request with no User-Agent.
    'user-agent': 'kabmo-console',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}
