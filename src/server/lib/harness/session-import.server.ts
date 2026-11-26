/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Copy the sessions an agent already holds into the index the sidebar reads.
 *
 * Kabmo's sidebar has two sources: omp's JSONL scan and `harness_sessions`
 * (written at spawn). A chat that was born in a terminal has neither, so it is
 * invisible — the whole of issue #3. This module asks the AGENT, through the
 * `session/list` capability it advertises, and writes one row per session it
 * reports. Discovery stays generic: no per-agent store parser, and a harness
 * that does not advertise `list` simply cannot be imported.
 *
 * Three measured rules:
 *
 *  - **No `cwd` on the request.** codex's cwd-filtered list tears its
 *    app-server down before answering (exit 0, reproduced 3/3 on 2.5.0; 2.7.0
 *    fails without a cwd too). The rows carry their own `cwd`, and Kabmo files
 *    them locally.
 *  - **`session/list` may race the agent's own shutdown.** A first call has
 *    been seen to answer `ACP agent exited (code 0)` before any frame; one
 *    fresh-process retry is what makes the action dependable.
 *  - **Both ids are a dedupe key.** A resumed chat whose load forked keeps
 *    Kabmo's id in `session_id` and the agent's in `agent_session_id`; a check
 *    on `session_id` alone imported a second row for one conversation.
 */

import { AcpProcess } from '@kabmo-labs/kabmo-acp-client/client';
import { listAllSessions } from '@kabmo-labs/kabmo-acp-protocol/verbs';
import { withGatewayCompatibility } from '@kabmo-labs/kabmo-acp-client/gateway-env';
import { loadHarnessConfig } from '@kabmo-labs/kabmo-harness-config-store/config.server';
import { resolveAccountLaunch } from '@kabmo-labs/kabmo-harness-account-store';
import { ensureCustomHarnesses } from '@kabmo-labs/kabmo-harness-config-store/custom.server';
import { harnessSessionKnown, importHarnessSession } from '@kabmo-labs/kabmo-harness-session/session-store.server';
import { sessionsWithoutTranscript } from '@kabmo-labs/kabmo-harness-session/session-transcript.server';
import { loadDeletedSessionIds } from '@kabmo-labs/kabmo-session-deleted';
import { canonicalPath } from '@kabmo-labs/kabmo-fs-canonical';
import { resolveProjectRoot } from '@kabmo-labs/kabmo-omp-worktree';
import { getDb } from '@/server/db.server';
import { emitRealtimeSignal } from '@kabmo-labs/kabmo-realtime-signals';
import { harnessDescriptor, type HarnessId } from '@kabmo-labs/kabmo-harness-catalog';
import type { AcpSessionInfo } from '@kabmo-labs/kabmo-acp-protocol/protocol';
import type { HarnessSessionImport } from '@/shared/types/harness';

/** One fresh process' worth of listing, disposed whatever happens. */
async function listOnce(
  command: string[],
  env?: Record<string, string>,
  envDrop?: readonly string[],
): Promise<AcpSessionInfo[]> {
  let tail = '';
  const proc = new AcpProcess({
    command,
    cwd: process.cwd(),
    onNotification: () => {},
    // The agent's own last words: a dead adapter reports `exited (code 1)`,
    // which names nothing a reader can act on.
    onStderr: (line) => { tail = `${tail}${line}\n`.slice(-2_000); },
    ...(env ? { env } : {}),
    ...(envDrop ? { envDrop } : {}),
  });
  try {
    await proc.initialize(undefined, 60_000);
    return await listAllSessions(proc.call, 60_000);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const detail = tail.trim().split('\n').slice(-3).join(' · ');
    throw new Error(detail && !message.includes(detail) ? `${message} — ${detail}` : message);
  } finally {
    await proc.dispose(1_000).catch(() => {});
  }
}

/** The agent's own session list, with the one retry the transport's shutdown
 *  race needs. A real refusal (auth, launch) is never retried. */
async function listSessions(
  command: string[],
  env?: Record<string, string>,
  envDrop?: readonly string[],
): Promise<AcpSessionInfo[]> {
  try {
    return await listOnce(command, env, envDrop);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (!/exited \(code 0\)|has exited/i.test(message)) throw cause;
    await new Promise((resolve) => setTimeout(resolve, 250));
    return await listOnce(command, env, envDrop);
  }
}

/** The canonical project roots the sidebar files sessions under. */
async function workspaceRoots(): Promise<Set<string>> {
  const db = await getDb();
  const rows = (await db.all(
    "SELECT project_path FROM workspace_folders WHERE project_path IS NOT NULL AND project_path <> ''",
  )) as { project_path: string }[];
  const roots = await Promise.all(rows.map((row) => canonicalPath(row.project_path).catch(() => row.project_path)));
  return new Set(roots);
}

function timestampOf(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Import every session `id` reports.
 *
 * A refusal is THROWN: the route turns it into the agent's own words, and the
 * card shows them. Answering `{ imported: 0 }` for a failed list would be the
 * silent substitution this codebase forbids.
 */
export async function importHarnessSessions(id: HarnessId): Promise<HarnessSessionImport> {
  if (harnessDescriptor(id)?.builtIn) {
    throw new Error(`${id} is built in and holds no importable session list`);
  }
  await ensureCustomHarnesses();
  const configured = await loadHarnessConfig(id);
  let launch;
  try {
    launch = await resolveAccountLaunch(id, configured);
  } catch (cause) {
    throw new Error(cause instanceof Error ? cause.message : String(cause));
  }
  const sessions = await listSessions(
    launch.command,
    withGatewayCompatibility(id, launch.env),
    launch.stripEnv,
  );
  const roots = await workspaceRoots();
  // A session the agent created and never used has no transcript in its own
  // store. Importing it would draw a sidebar row that opens an empty chat, so
  // the pass skips it and reports the count. A store Kabmo cannot read yields
  // no verdict, and the row is imported as before.
  const withoutTranscript = await sessionsWithoutTranscript(
    sessions.map((session) => ({ harness: id, sessionId: session.sessionId })),
  );
  // A deleted chat stays deleted. The agent's store is the source this pass
  // copies from, so without the tombstone a delete that only removed Kabmo's
  // rows (or an agent that kept its copy) put the chat back on the next pass.
  const deleted = await loadDeletedSessionIds();

  let imported = 0;
  let known = 0;
  let outside = 0;
  let empty = 0;
  let tombstoned = 0;
  for (const session of sessions) {
    if (deleted.has(session.sessionId)) {
      tombstoned += 1;
      continue;
    }
    if (withoutTranscript.has(session.sessionId)) {
      empty += 1;
      continue;
    }
    const cwd = typeof session.cwd === 'string' ? session.cwd.trim() : '';
    if (!cwd) {
      outside += 1;
      continue;
    }
    const root = await resolveProjectRoot(cwd).catch(() => '');
    const key = root ? await canonicalPath(root).catch(() => root) : '';
    if (!key || !roots.has(key)) {
      outside += 1;
      continue;
    }
    if (await harnessSessionKnown(session.sessionId)) {
      known += 1;
      continue;
    }
    const updatedAt = timestampOf(session.updatedAt);
    const inserted = await importHarnessSession({
      sessionId: session.sessionId,
      harness: id,
      agentSessionId: '',
      cwd,
      title: session.title ?? '',
      // `session/list` publishes no creation time. The first sighting is the
      // honest value, and the sidebar sorts on `updated_at` anyway.
      createdAt: updatedAt,
      updatedAt,
    });
    if (inserted) imported += 1;
    else known += 1;
  }
  if (imported > 0) emitRealtimeSignal('sidebar-structure');
  return { harness: id, imported, known, outside, empty, deleted: tombstoned };
}
