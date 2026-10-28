/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read one session's plan-mode artifacts from disk.
 *
 * A plan is a `local://` artifact, so it is not in the transcript and not in
 * Kabmo's database: omp writes it under the session's own artifacts
 * directory, which is the session file's path minus its `.jsonl` suffix, plus
 * `local/` (`resolveLocalRoot` → `artifactsDir/local`). Every plan lands there
 * as `<slug>-plan.md`, so the read is: locate the session file, derive that
 * directory, and list it.
 *
 * Two things this deliberately does NOT do:
 *
 *   - **It never spawns an omp process.** The artifact root is derivable from
 *     the file path alone, and a panel that booted a child to ask about a plan
 *     would fight the chat's own session wrapper for the same session file.
 *   - **It never writes.** omp owns these files, the popup owns the review, and
 *     this view exists to WATCH them.
 *
 * The transcript is consulted for one thing only: which plan the session's plan
 * mode currently names (`mode_change` with `mode: 'plan'` carries
 * `data.planFilePath`). That is what makes the panel open on the plan the agent
 * is actually working from when a session holds several, with the newest file
 * as the fallback. The parse is cached by size+mtime, the same rule the todo
 * reader follows and for the same reason: it may sit megabytes from EOF.
 */

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { parseJsonlLenient } from '@/shared/lib/omp/session/jsonl';
import type { SessionPlanState, SessionPlanFile } from '@/shared/types/plan';

/** Suffix omp gives every plan artifact (`<slug>-plan.md`). */
const PLAN_SUFFIX = /plan\.md$/i;

/** A plan past this is served truncated; it is a document for a human, and the
 *  read runs behind an HTTP request. */
const MAX_PLAN_BYTES = 1024 * 1024;

const EMPTY_PLAN_STATE: SessionPlanState = { files: [], current: null, content: null, truncated: false };

interface PlanPathCacheEntry {
  size: number;
  mtimeMs: number;
  /** `local://<slug>-plan.md` named by the newest plan-mode entry, or null. */
  current: string | null;
}

/**
 * Cache keyed by session id, hung off `globalThis` for the same reason the
 * database handle is: a `bun --hot` reload re-evaluates this module, and a
 * module-level map would be dropped while the parsed result stays valid.
 */
interface PlanCacheHost {
  entries: Map<string, PlanPathCacheEntry>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoPlanPaths: PlanCacheHost | undefined;
}

function cache(): PlanCacheHost {
  if (!globalThis.__kabmoPlanPaths) globalThis.__kabmoPlanPaths = { entries: new Map() };
  return globalThis.__kabmoPlanPaths;
}

/** The `local/` artifact root beside a session file. */
export function localRootForSessionFile(sessionFile: string): string {
  return path.join(sessionFile.replace(/\.jsonl$/i, ''), 'local');
}

/**
 * The plan a session's plan mode names, newest entry first.
 *
 * Only `mode_change` speaks here: Kabmo's own `kabmo-plan-state` entry
 * records the boolean, and the model's `xd://propose` write is a tool call that
 * names a title rather than a path.
 */
function currentPlanFromTranscript(body: string): string | null {
  const lines = parseJsonlLenient<Record<string, unknown>>(body);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const entry = lines[i];
    if (entry?.type !== 'mode_change' || entry.mode !== 'plan') continue;
    const data = entry.data;
    if (!data || typeof data !== 'object') continue;
    const candidate = (data as Record<string, unknown>).planFilePath;
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return null;
}

/** The transcript's named plan path, cached by size+mtime. */
async function readCurrentPlanPath(sessionId: string, sessionFile: string): Promise<string | null> {
  try {
    const info = await stat(sessionFile);
    const cached = cache().entries.get(sessionId);
    if (cached && cached.size === info.size && cached.mtimeMs === info.mtimeMs) return cached.current;
    const body = await Bun.file(sessionFile).text();
    const current = currentPlanFromTranscript(body);
    cache().entries.set(sessionId, { size: info.size, mtimeMs: info.mtimeMs, current });
    return current;
  } catch {
    return null;
  }
}

/** List the plan artifacts in a directory, newest first, with their sizes. */
async function listPlanFiles(localDir: string): Promise<SessionPlanFile[]> {
  try {
    const entries = await readdir(localDir, { withFileTypes: true });
    const plans: SessionPlanFile[] = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && PLAN_SUFFIX.test(entry.name))
        .map(async (entry) => {
          const info = await stat(path.join(localDir, entry.name)).catch(() => null);
          return {
            path: `local://${entry.name}`,
            title: entry.name.replace(PLAN_SUFFIX, ''),
            modifiedAt: info?.mtimeMs ?? 0,
            bytes: info?.size ?? 0,
          };
        }),
    );
    return plans.sort((a, b) => b.modifiedAt - a.modifiedAt);
  } catch {
    // A session with no artifacts directory has no plans — not an error.
    return [];
  }
}

/**
 * A requested artifact name, or null when it is not one this reader may open.
 *
 * The guard is the security boundary: `localDir` is fixed, so only a bare
 * filename can be joined to it. A `..`, a separator or an absolute path is
 * refused before it reaches the filesystem, and the name must look like a plan
 * (the same suffix the listing filters on) so this route cannot be used to read
 * an arbitrary file that happens to sit in the artifacts directory.
 */
export function safePlanName(requested: string | null | undefined): string | null {
  if (!requested) return null;
  const name = requested.replace(/^local:\/+/i, '');
  if (!name || name !== path.basename(name) || name.includes('..')) return null;
  return PLAN_SUFFIX.test(name) ? name : null;
}

/**
 * One session's plan artifacts, plus the chosen plan's body.
 *
 * Returns an empty state (never a throw) for a session whose file cannot be
 * found: the panel renders "no plan yet" rather than an error for what is a
 * normal state.
 */
export async function readSessionPlans(sessionId: string, requested?: string | null): Promise<SessionPlanState> {
  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return EMPTY_PLAN_STATE;

  const localDir = localRootForSessionFile(sessionFile);
  const files = await listPlanFiles(localDir);
  if (files.length === 0) return { ...EMPTY_PLAN_STATE, current: null };

  // The transcript's pick wins when it still exists — that is the plan the
  // agent is working from. Otherwise the newest file, which is what a session
  // whose plan mode has moved on should open on.
  const named = await readCurrentPlanPath(sessionId, sessionFile);
  const namedName = safePlanName(named);
  const current = namedName && files.some((file) => file.path === `local://${namedName}`)
    ? `local://${namedName}`
    : files[0]?.path ?? null;

  const requestedName = safePlanName(requested);
  const target = requestedName && files.some((file) => file.path === `local://${requestedName}`)
    ? requestedName
    : safePlanName(current);
  if (!target) return { files, current, content: null, truncated: false };

  try {
    const file = Bun.file(path.join(localDir, target));
    const info = await file.stat();
    const truncated = info.size > MAX_PLAN_BYTES;
    const text = truncated ? await file.slice(0, MAX_PLAN_BYTES).text() : await file.text();
    return { files, current, content: text, truncated };
  } catch {
    return { files, current, content: null, truncated: false };
  }
}
