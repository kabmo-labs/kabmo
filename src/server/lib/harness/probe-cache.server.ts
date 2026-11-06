/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The probe cache: what each agent reported, kept for the process AND for disk.
 *
 * Two callers need the answer: the settings page's "Check status", and the SPAWN,
 * which resolves a harness's configured default model against the models that
 * agent actually published. Reading the cache from `routes/harness/root.ts` would
 * have made the spawn import a route, so it lives here.
 *
 * **Memory alone was the bug.** The map was process-scoped, so every restart —
 * including a `bun --hot` reload, which is every edit during development —
 * emptied it and every harness fell back to `not probed` while the user was
 * looking at a card that had said `ready` a minute earlier. A probe is a fact
 * about the INSTALLED BINARY, not about this process, so it is now written to
 * `harness_probes` and read back on the first miss. The memory map stays in front
 * of it: the settings page and the composer's tab strip both ask on every mount,
 * and a database round trip per row would be the cost this cache exists to avoid.
 *
 * **`probedAt` ages a probe; it must not DELETE it.** A row older than
 * `PROBE_TTL_MS` used to be read as absent, which reproduced the reported bug by
 * another route: probe a harness, come back an hour later (or restart the app),
 * and the card said `not probed` while `harness_probes` still held the answer.
 * Measured on a cold process against this database: `omp-acp` (17 min old)
 * answered, `claude` (61 min old) read as absent. So a stored record is now
 * always returned and carries `stale: true` once it is past the TTL, and the
 * card says when it was last checked instead of forgetting it. The real
 * invalidators are the ones that change what was measured: a launch line or env
 * edit (`forgetProbe` from `probeInvalidatedBy`) and an install (`update.ts`).
 */

import { getDb } from '@/server/db.server';
import type { HarnessProbe } from '@/server/lib/harness/capabilities';
import type { HarnessId } from '@/shared/lib/harness/catalog';

declare global {
  // eslint-disable-next-line no-var
  var __kabmoHarnessProbes: Map<string, HarnessProbe> | undefined;
}

/** How long a probe is reported as CURRENT. Past it the record is still
 *  returned — see the header — and only flagged, never discarded. */
export const PROBE_TTL_MS = 30 * 60_000;

export function probes(): Map<string, HarnessProbe> {
  globalThis.__kabmoHarnessProbes ??= new Map();
  return globalThis.__kabmoHarnessProbes;
}

/** True when the record is young enough to be reported without an age. */
export function isFresh(probe: HarnessProbe): boolean {
  return Date.now() - probe.probedAt < PROBE_TTL_MS;
}

/** The probe as the wire reports it: the record plus whether it has aged past
 *  the TTL. `stale` is a LABEL, not a filter — the card shows the answer with
 *  its age instead of pretending the harness was never asked. */
export type StoredProbe = HarnessProbe & { stale?: true };

/** Attach the ageing label to a live record. */
function labelled(probe: HarnessProbe): StoredProbe {
  return isFresh(probe) ? probe : { ...probe, stale: true };
}

/**
 * Store a probe in memory and on disk.
 *
 * The write is awaited by the routes that call it: a probe the user just
 * triggered must survive a reload of the page — and of the server — or the button
 * reports success while the next read disagrees.
 */
export async function rememberProbe(id: HarnessId, probe: HarnessProbe): Promise<void> {
  probes().set(id, probe);
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO harness_probes (harness, payload, probed_at) VALUES (?, ?, ?)
       ON CONFLICT(harness) DO UPDATE SET payload = excluded.payload, probed_at = excluded.probed_at`,
      [id, JSON.stringify(probe), probe.probedAt],
    );
  } catch {
    // no-excuse-ok: catch — the probe still answers THIS process from memory; a
    // database that cannot take the row must not fail the user's Check status.
  }
}

/** Forget a probe in memory and on disk (a launch line or env changed, so what
 *  the last probe measured no longer describes this harness). */
export async function forgetProbe(id: HarnessId): Promise<void> {
  probes().delete(id);
  try {
    const db = await getDb();
    await db.run('DELETE FROM harness_probes WHERE harness = ?', [id]);
  } catch {
    // no-excuse-ok: catch — forgetting from memory is enough for this process.
  }
}

/** The stored record for a harness, from memory or from disk.
 *
 *  An AGED record is returned, never dropped: the user asked for it once, so a
 *  card that says `not probed` an hour later is the bug this file exists to
 *  fix. `labelled` marks how old it is; `harnessProbeModels` is the strict read
 *  that refuses to act on a record past the TTL. */
async function readProbe(id: HarnessId): Promise<StoredProbe | null> {
  const cached = probes().get(id);
  if (cached) return labelled(cached);
  try {
    const db = await getDb();
    const row = (await db.get('SELECT payload FROM harness_probes WHERE harness = ?', [id])) as
      | { payload?: string }
      | null;
    if (!row?.payload) return null;
    const parsed = JSON.parse(row.payload) as HarnessProbe;
    if (!parsed || typeof parsed.probedAt !== 'number') return null;
    probes().set(id, parsed);
    return labelled(parsed);
  } catch {
    return null;
  }
}

/**
 * Every stored probe, keyed by harness, aged rows included.
 *
 * `listHarnesses` builds the whole catalog in one pass, so it asks for all of
 * them at once rather than one await per row.
 */
export async function loadProbes(): Promise<Map<string, StoredProbe>> {
  const out = new Map<string, StoredProbe>();
  try {
    const db = await getDb();
    const rows = (await db.all('SELECT harness, payload FROM harness_probes')) as {
      harness: string;
      payload: string;
    }[];
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.payload) as HarnessProbe;
        if (!parsed || typeof parsed.probedAt !== 'number') continue;
        out.set(row.harness, labelled(parsed));
        probes().set(row.harness, parsed);
      } catch {
        // A row written by an older build with a different shape: skip it rather
        // than fail the whole catalog.
        continue;
      }
    }
  } catch {
    // No database yet: memory is the whole answer for this process.
  }
  // Anything in MEMORY but not yet flushed wins, so a probe in flight is never
  // hidden by a slower disk.
  for (const [id, probe] of probes()) {
    if (!out.has(id)) out.set(id, labelled(probe));
  }
  return out;
}

/** The models a harness published, if its probe is still CURRENT; else none.
 *
 *  The strict read, deliberately: a spawn that inherited a model from an aged
 *  probe could write a selector the agent no longer offers. Showing an old
 *  answer on a card is honest; ACTING on one is not. */
export async function harnessProbeModels(id: HarnessId): Promise<{ value: string; name: string }[]> {
  const probe = await readProbe(id);
  return probe && !probe.stale ? probe.models : [];
}

/** The stored probe for a harness, aged or not, or null when it was never
 *  recorded. */
export async function freshProbe(id: HarnessId): Promise<StoredProbe | null> {
  return readProbe(id);
}
