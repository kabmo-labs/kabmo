/**
 * Every action a workflow runs is on a runtime GitHub still supports.
 *
 * The failure this prevents is a WARNING, not a red build: on the 2026-11-21
 * release run GitHub reported
 *
 *   Node.js 20 is deprecated. The following actions target Node.js 20 but are
 *   being forced to run on Node.js 24: actions/cache@v4.
 *
 * and the job passed anyway. A warning in a green run is the shape of defect
 * that sits in the log until the day the forced upgrade is removed — and then
 * every workflow using that major breaks at once, in a release, with no code
 * change to blame.
 *
 * The table below is the FIRST major of each action that runs on Node 24,
 * read from that release's own `action.yml` (`runs.using: node24`), not guessed
 * from the tag number. A pin below it is the deprecation, so this is an
 * assertion on a measured fact rather than on a preference for new versions.
 */

import { expect, test, describe } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const WORKFLOWS = join(import.meta.dir, '../.github/workflows');

/**
 * The oldest major of each action that runs on Node 24.
 *
 * Verified against `action.yml` at that tag:
 * - `actions/cache@v5`  — `using: node24` (v4 is node20).
 * - `actions/upload-artifact@v6` — v5 still declared node20.
 * - `actions/download-artifact@v7` — v6 still declared node20.
 * - `actions/setup-java@v5`, `actions/setup-dotnet@v5`,
 *   `actions/setup-android@v4`, `actions/setup-node@v7`,
 *   `actions/checkout@v5` — all `node24`.
 */
const NODE24_FLOOR: Record<string, number> = {
  'actions/cache': 5,
  'actions/upload-artifact': 6,
  'actions/download-artifact': 7,
  'actions/setup-java': 5,
  'actions/setup-dotnet': 5,
  'actions/setup-node': 7,
  'actions/checkout': 5,
  'android-actions/setup-android': 4,
};

/** `owner/repo` and the major from a `uses:` reference, or null for a local/Docker one. */
function parseUses(value: string): { action: string; major: number | null } | null {
  // `./.github/workflows/x.yml` is a reusable workflow, and `docker://…` a
  // container: neither has a Node runtime to be deprecated.
  if (value.startsWith('./') || value.startsWith('docker://')) return null;
  const at = value.lastIndexOf('@');
  if (at < 0) return null;
  const action = value.slice(0, at);
  const ref = value.slice(at + 1);
  // A SHA pin (`actions/checkout@3d3c42e5…`) carries its major in the trailing
  // `# v7.0.1` comment, which YAML parsing drops — so a SHA pin is exempt here
  // and the comment is the reviewer's evidence. The map exists to catch a
  // floating tag left behind, which is the way a major actually drifts.
  const major = /^v(\d+)$/.exec(ref);
  return { action, major: major ? Number(major[1]) : null };
}

describe('the workflows run on supported action runtimes', () => {
  test('no action is pinned below the first major that runs on Node 24', async () => {
    const files = readdirSync(WORKFLOWS).filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
    expect(files.length, 'no workflow files were found').toBeGreaterThan(10);

    const stale: string[] = [];
    let checked = 0;
    for (const file of files) {
      const text = await Bun.file(join(WORKFLOWS, file)).text();
      const doc = Bun.YAML.parse(text) as { jobs?: Record<string, { steps?: Array<{ uses?: string }> }> };
      for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
        for (const step of job.steps ?? []) {
          if (!step.uses) continue;
          const parsed = parseUses(step.uses);
          if (parsed?.major == null) continue;
          const floor = NODE24_FLOOR[parsed.action];
          if (floor === undefined) continue;
          checked += 1;
          if (parsed.major < floor) {
            stale.push(`${file} → ${jobName}: ${step.uses} (needs v${floor} or later)`);
          }
        }
      }
    }

    // The check is vacuous if the search stopped matching — a changed `uses:`
    // shape or a renamed directory would make every workflow pass while reading
    // nothing.
    expect(checked, 'no action reference was checked at all').toBeGreaterThan(20);
    expect(stale, `these actions still target Node 20:\n${stale.join('\n')}`).toEqual([]);
  });
});
