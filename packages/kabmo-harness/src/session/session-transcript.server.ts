/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which imported sessions have NO transcript in the agent's own store.
 *
 * An import copies every row `session/list` reports, and an agent reports the
 * sessions it CREATED, not the ones that were used: measured on this machine,
 * 114 of opencode's 131 sessions hold zero messages, and the sidebar drew them
 * as `New session - <timestamp>` rows that open an empty chat. The same is true
 * of omp's own scan (208 of 1793 files carry a header and no message), which is
 * why the sidebar filters both sources through one rule: a row is listed only
 * when a transcript exists.
 *
 * The verdict is deliberately three-valued. Kabmo can read the store of the
 * agents it names here; for any other harness the answer is "unknown", and the
 * caller KEEPS the row. Hiding a real chat is worse than listing an empty one,
 * and a store that cannot be read is not evidence of an empty session.
 *
 * The checks are cheap and batched per harness: one SQLite query for opencode,
 * one directory listing for dsh/claude, one glob per id for codex. They run on
 * the sidebar's structure build and on the import pass, never per row per
 * folder.
 */

import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { antigravityHome } from '@kabmo-labs/kabmo-harness/local-transcript/antigravity-home';
import { codexHome, findCodexRollout } from '@kabmo-labs/kabmo-harness/local-transcript/codex-transcript';
import { isSinglePathSegment } from '@kabmo-labs/kabmo-paths/path-segment';

/** The two facts a store check needs: which agent, and which session. */
export interface SessionRef {
  harness: string;
  sessionId: string;
}

/** A store check: the ids it can PROVE hold a transcript, or `null` when the
 *  store itself is unreadable and no verdict is possible. */
type StoreCheck = (ids: readonly string[]) => Promise<Set<string> | null>;

/**
 * opencode keeps its history in one SQLite file, and the schema has two
 * generations: `message` (v1) and `session_message` (v2). A session is present
 * when EITHER table holds a row for it; a table that does not exist in this
 * install is skipped rather than failing the whole check.
 */
async function opencodeTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  const dataHome = Bun.env.XDG_DATA_HOME?.trim() || join(homedir(), '.local', 'share');
  const path = join(dataHome, 'opencode', 'opencode.db');
  try {
    if (!(await fs.promises.stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    db.exec('PRAGMA busy_timeout = 500');
    const placeholders = ids.map(() => '?').join(',');
    const present = new Set<string>();
    let answered = false;
    for (const table of ['message', 'session_message']) {
      try {
        const rows = db
          .query(`SELECT DISTINCT session_id FROM ${table} WHERE session_id IN (${placeholders})`)
          .all(...ids) as { session_id: string }[];
        answered = true;
        for (const row of rows) present.add(row.session_id);
      } catch {
        // This install predates (or postdates) the table; the other one answers.
      }
    }
    return answered ? present : null;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** The dsh sessions root: `DSH_HOME` or `~/.dsh`. */
function dshSessionsRoot(): string {
  return join(Bun.env.DSH_HOME?.trim() || join(homedir(), '.dsh'), 'sessions');
}

/**
 * The session directories dsh keeps for one id.
 *
 * dsh derives its project directory from the cwd, so the id alone is not a
 * path — the project level is scanned instead of re-encoding a cwd the row may
 * no longer have. A missing root answers empty.
 */
export async function dshStoreDirs(agentSessionId: string): Promise<string[]> {
  if (!isSinglePathSegment(agentSessionId)) return [];
  const root = dshSessionsRoot();
  let projects: string[];
  try {
    projects = await fs.promises.readdir(root);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const project of projects) {
    const candidate = join(root, project, agentSessionId);
    try {
      if ((await fs.promises.stat(candidate)).isDirectory()) found.push(candidate);
    } catch {
      // Not this project: the id lives in one project directory, and the rest
      // are ordinary misses.
    }
  }
  return found;
}

/**
 * The dsh events that mean a conversation happened. A session directory is
 * created with a header and its setup events (`permission/preset`,
 * `sandbox/mode`, `approval/policy`) before the first prompt, so a non-empty
 * file is not a transcript: measured on this machine, every dsh session held
 * those four lines and nothing else, and the sidebar listed them as empty
 * chats. The file is zstd-compressed JSONL, so the check decompresses it and
 * looks for a turn or a message.
 */
const DSH_CONVERSATION_MARKERS = ['"type":"turn/start"', '"type":"user/message"', '"type":"assistant/message"'];

/** dsh writes one compressed transcript per session directory. */
async function dshTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  const root = dshSessionsRoot();
  let projects: string[];
  try {
    projects = await fs.promises.readdir(root);
  } catch {
    return null;
  }
  const present = new Set<string>();
  for (const id of ids) {
    if (!isSinglePathSegment(id)) continue;
    for (const project of projects) {
      try {
        const bytes = new Uint8Array(
          await Bun.file(join(root, project, id, 'session.v4.jsonl.zstd')).arrayBuffer(),
        );
        if (bytes.length === 0) continue;
        const text = new TextDecoder().decode(Bun.zstdDecompressSync(bytes));
        if (DSH_CONVERSATION_MARKERS.some((marker) => text.includes(marker))) {
          present.add(id);
          break;
        }
      } catch {
        // Not this project, or not a readable zstd transcript.
      }
    }
  }
  return present;
}

/** claude writes `<projects>/<encoded-cwd>/<id>.jsonl`. */
async function claudeTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  const home = Bun.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  const root = join(home, 'projects');
  let projects: string[];
  try {
    projects = await fs.promises.readdir(root);
  } catch {
    return null;
  }
  const present = new Set<string>();
  for (const id of ids) {
    if (!isSinglePathSegment(id)) continue;
    for (const project of projects) {
      try {
        const stat = await fs.promises.stat(join(root, project, `${id}.jsonl`));
        if (stat.isFile() && stat.size > 0) {
          present.add(id);
          break;
        }
      } catch {
        // Not this project.
      }
    }
  }
  return present;
}

/** codex writes one rollout file per session, under its own home. */
async function codexTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  try {
    if (!(await fs.promises.stat(await codexHome())).isDirectory()) return null;
  } catch {
    return null;
  }
  const present = new Set<string>();
  for (const id of ids) {
    if (await findCodexRollout(id)) present.add(id);
  }
  return present;
}

/** zcode keeps its history in one SQLite file, like opencode. */
async function zcodeTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  const home = Bun.env.ZCODE_HOME?.trim() || join(homedir(), '.zcode');
  const path = join(home, 'cli', 'db', 'db.sqlite');
  try {
    if (!(await fs.promises.stat(path)).isFile()) return null;
  } catch {
    return null;
  }
  let db: Database | null = null;
  try {
    db = new Database(path, { readonly: true });
    db.exec('PRAGMA busy_timeout = 500');
    const placeholders = ids.map(() => '?').join(',');
    const rows = db
      .query(`SELECT DISTINCT session_id FROM message WHERE session_id IN (${placeholders})`)
      .all(...ids) as { session_id: string }[];
    return new Set(rows.map((row) => row.session_id));
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * antigravity writes one SQLite conversation per session, under the CLI's
 * `conversations/` (the ACP adapter's store) or the IDE's. A conversation with
 * no `steps` row is a session that was opened and never used.
 */
async function antigravityTranscripts(ids: readonly string[]): Promise<Set<string> | null> {
  const home = antigravityHome();
  const roots = [
    join(home, 'antigravity-cli', 'conversations'),
    join(home, 'antigravity', 'conversations'),
  ];
  let readable = false;
  const present = new Set<string>();
  for (const id of ids) {
    if (!isSinglePathSegment(id)) continue;
    for (const root of roots) {
      const path = join(root, `${id}.db`);
      try {
        if (!(await fs.promises.stat(path)).isFile()) continue;
        readable = true;
        const db = new Database(path, { readonly: true });
        try {
          db.exec('PRAGMA busy_timeout = 500');
          const row = db.query('SELECT 1 AS present FROM steps LIMIT 1').get() as { present?: number } | null;
          if (row) present.add(id);
        } finally {
          db.close();
        }
        break;
      } catch {
        // Not this root, or a conversation this build cannot read.
      }
    }
  }
  return readable ? present : null;
}

/** The stores Kabmo can read. A harness absent here has no verdict. */
const STORE_CHECKS: Record<string, StoreCheck> = {
  opencode: opencodeTranscripts,
  dsh: dshTranscripts,
  claude: claudeTranscripts,
  codex: codexTranscripts,
  zcode: zcodeTranscripts,
  antigravity: antigravityTranscripts,
};

/**
 * The session ids whose agent store PROVABLY holds no transcript.
 *
 * A harness with no readable store, or a store that fails to answer, yields no
 * ids: the caller keeps those rows. The result is keyed by session id alone,
 * because a session id is unique across the harnesses Kabmo records.
 */
export async function sessionsWithoutTranscript(rows: readonly SessionRef[]): Promise<Set<string>> {
  const byHarness = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.sessionId) continue;
    const bucket = byHarness.get(row.harness);
    if (bucket) bucket.push(row.sessionId);
    else byHarness.set(row.harness, [row.sessionId]);
  }
  const absent = new Set<string>();
  for (const [harness, ids] of byHarness) {
    const check = STORE_CHECKS[harness];
    if (!check) continue;
    const present = await check(ids).catch(() => null);
    if (!present) continue;
    for (const id of ids) {
      if (!present.has(id)) absent.add(id);
    }
  }
  return absent;
}
