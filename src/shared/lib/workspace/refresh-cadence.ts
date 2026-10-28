/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Single source of truth for the timings Kabmo still reasons about.
 *
 * Most of what used to live here is gone: the panel, sidebar, git, schedule and
 * repo-discovery polls were replaced by the realtime socket's topics, so only
 * the CDP screencast poll, the transports' keepalive, the server-side dataset
 * TTL and the spawn retry backoff remain.
 *
 * Keep them here so a cost/freshness trade-off can be reasoned about in one
 * place. Imported by client hooks, shared browser modules, and server routes
 * alike — this module must stay free of `node:`/`Bun.*` imports.
 */

/**
 * Nested-repo discovery and the sidebar's schedule badge both ride realtime
 * topics (`repos:<root>`, the schedule topic), so neither has a poll cadence
 * here: the server republishes the moment the underlying state changes.
 */

/**
 * CDP state/screencast poll. Latency-sensitive — the browser panel streams a
 * live page, so this one stays tight on purpose.
 */
export const BROWSER_POLL_MS = 1_000;

/**
 * Keep-alive comment frame for long-lived SSE/WS transports (agent bridge and
 * browser stream). Not a data refresh — it keeps proxies from reaping an idle
 * connection.
 */
export const STREAM_HEARTBEAT_MS = 30_000;

/**
 * TTL for the server-side sidebar dataset scan (`loadOmpSidebarData`). Nothing
 * polls this cache — the sidebar rides the realtime socket — so the TTL only
 * dedupes concurrent resolves of one publish burst; a structure publish
 * invalidates it outright.
 */
export const SIDEBAR_DATA_TTL_MS = 4_000;

/**
 * Retry backoff (ms) used while waiting for a freshly spawned omp session's
 * JSONL to carry the user turn. Each entry is the delay BEFORE the next
 * attempt; attempt 1 runs immediately, so the total attempt count is
 * `length + 1` and the elapsed budget is the sum (~15.5s over 13 attempts).
 *
 * Front-loaded on purpose: omp usually writes the turn within a second, so the
 * early 250ms probes land the real title fast, while the 2s tail keeps watching
 * a slow spawn without spending 40 requests to do it.
 */
export const SESSION_META_RETRY_SCHEDULE_MS: readonly number[] = [
  250, 250, 500, 500, 1_000, 1_000, 2_000, 2_000, 2_000, 2_000, 2_000, 2_000,
];
