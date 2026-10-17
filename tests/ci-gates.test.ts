/**
 * The release pipeline's gate contract, asserted.
 *
 * `release.yml`, `publish.yml` and `publish-plugins.yml` can tag and publish, so
 * each of them must run the gates and the browser specs and must not reach a
 * release job without them. That is a fact about YAML, and the failure mode is
 * silent: a job added without `needs`, a renamed reusable workflow, an input
 * spelled one way in the caller and another in the callee — none of them is
 * visible until the day a red `main` gets tagged.
 *
 * The assertions are on the GRAPH, not on the file text: every job that does
 * anything in a releasing workflow must depend, transitively, on both gate
 * jobs. A new job that forgets its `needs` therefore fails here rather than in
 * production.
 */
import { expect, test, describe } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');

/** The two reusable workflows that ARE the gates. */
const GATES = './.github/workflows/gates.yml';
const E2E = './.github/workflows/e2e-specs.yml';

/** Every workflow that can tag or publish, and therefore must be gated. */
const RELEASING = ['release.yml', 'publish.yml', 'publish-plugins.yml'];

/** The trigger files, which call the reusable workflows but release nothing. */
const TRIGGERS: Record<string, string> = {
  'ci.yml': GATES,
  'e2e.yml': E2E,
};

/** Read one workflow as parsed YAML. */
async function load(file: string): Promise<Record<string, any>> {
  const text = await Bun.file(join(WORKFLOWS, file)).text();
  return Bun.YAML.parse(text) as Record<string, any>;
}

describe('the gate contract', () => {
  test('the reusable workflows exist and are callable', async () => {
    for (const file of ['gates.yml', 'e2e-specs.yml']) {
      expect(existsSync(join(WORKFLOWS, file))).toBe(true);
      const doc = await load(file);
      // `workflow_call` is what makes a file callable at all. Without it the
      // caller fails with "invalid value for uses", which no gate would catch.
      expect(doc.on?.workflow_call).toBeDefined();
    }
  });

  test('every local reusable-workflow reference resolves and declares workflow_call', async () => {
    const seen = new Set<string>();
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS)]) {
      const doc = await load(file);
      for (const [id, job] of Object.entries<any>(doc.jobs ?? {})) {
        const uses = job?.uses;
        if (typeof uses !== 'string' || !uses.startsWith('./')) continue;
        expect(existsSync(join(ROOT, uses)), `${file}:${id} names a missing workflow (${uses})`).toBe(true);
        seen.add(uses);
        // A reusable workflow that does not declare `workflow_call` is a file
        // the caller cannot use — the failure is at run time, not here.
        const callee = await load(uses.replace('./.github/workflows/', ''));
        expect(callee.on?.workflow_call, `${uses} does not declare workflow_call`).toBeDefined();
      }
    }
    expect(seen.size).toBe(2);
  });

  test('a caller passes only inputs the callee declares', async () => {
    // An input the callee does not declare is a run-time failure ("Invalid
    // input, ... is not defined in the referenced workflow"), and it is exactly
    // the kind of typo a rename produces.
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS)]) {
      const doc = await load(file);
      for (const [id, job] of Object.entries<any>(doc.jobs ?? {})) {
        if (typeof job?.uses !== 'string' || !job.uses.startsWith('./')) continue;
        const callee = await load(job.uses.replace('./.github/workflows/', ''));
        const declared = new Set(Object.keys(callee.on?.workflow_call?.inputs ?? {}));
        for (const key of Object.keys(job.with ?? {})) {
          expect(declared.has(key), `${file}:${id} passes undeclared input "${key}"`).toBe(true);
        }
      }
    }
  });

  test('the trigger files call the reusable workflows they replace', async () => {
    for (const [file, target] of Object.entries(TRIGGERS)) {
      const doc = await load(file);
      const jobs = Object.values<any>(doc.jobs ?? {});
      const calls = jobs.map((job) => job?.uses).filter(Boolean);
      expect(calls, `${file} does not call ${target}`).toContain(target);
    }
  });

  test('a releasing workflow gates every job that acts', async () => {
    for (const file of RELEASING) {
      const doc = await load(file);
      const jobs = doc.jobs ?? {};

      // The two gate jobs themselves, by the workflow they call.
      const gateJobs = Object.entries<any>(jobs)
        .filter(([, job]) => job?.uses === GATES)
        .map(([id]) => id);
      const e2eJobs = Object.entries<any>(jobs)
        .filter(([, job]) => job?.uses === E2E)
        .map(([id]) => id);
      expect(gateJobs.length, `${file} does not call ${GATES}`).toBe(1);
      expect(e2eJobs.length, `${file} does not call ${E2E}`).toBe(1);

      // A gate with a condition is a gate that can be skipped, which is not a
      // gate. `if:` is deliberately allowed nowhere on these two jobs.
      for (const id of [...gateJobs, ...e2eJobs]) {
        expect(jobs[id].if, `${file}:${id} is a gate job with an if: condition`).toBeUndefined();
      }

      // Transitive closure: every other job must reach BOTH gates. This is the
      // assertion that catches a publish job added without `needs`.
      //
      // `needs` is a string when a job names one dependency and an array when it
      // names several, so it is normalized — spreading a bare string yields its
      // characters, and every lookup after that silently answers "no".
      //
      // The array is COPIED: `stack.pop()` mutates in place, so handing out the
      // parsed array itself empties the job's own `needs` as the walk consumes
      // it — the second job through the closure then sees a dependency list that
      // was already drained and reports a gate it does reach as missing.
      const needsOf = (id: string): string[] => {
        const value = jobs[id]?.needs;
        if (value === undefined) return [];
        return Array.isArray(value) ? [...value] : [value];
      };

      const reach = (id: string): Set<string> => {
        const out = new Set<string>();
        const stack = needsOf(id);
        while (stack.length > 0) {
          const next = stack.pop() as string;
          if (out.has(next)) continue;
          out.add(next);
          stack.push(...needsOf(next));
        }
        return out;
      };

      for (const id of Object.keys(jobs)) {
        if (gateJobs.includes(id) || e2eJobs.includes(id)) continue;
        const needs = reach(id);
        expect(needs.has(gateJobs[0]), `${file}:${id} does not depend on the gates`).toBe(true);
        expect(needs.has(e2eJobs[0]), `${file}:${id} does not depend on the browser specs`).toBe(true);
      }
    }
  });

  test('the app release still waits for the packages, through the marketplace bumps', async () => {
    // The ordering is load-bearing and it is the one thing the transitive check
    // above cannot see: `app` could depend on the gates directly and still race
    // the lockfile refresh.
    //
    // The chain is `packages -> marketplace -> app`, and BOTH hops matter.
    // `packages` commits the refreshed `bun.lock`, and a `workspace:` spec is
    // substituted from that record, so the app must not pack before it.
    // `marketplace` bumps the bundled plugins' versions into the same branch, and
    // the app's tarball is what carries them — so a bump landing after the app
    // packed would reach existing installs one release late.
    const doc = await load('release.yml');
    const needsOf = (id: string): string[] => {
      const value = doc.jobs[id]?.needs;
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    };

    expect(needsOf('marketplace')).toContain('packages');
    expect(needsOf('app')).toContain('marketplace');
  });

  test('nothing publishes before the gates in a publish workflow', async () => {
    for (const [file, job] of [
      ['publish.yml', 'publish'],
      ['publish-plugins.yml', 'publish'],
    ] as const) {
      const doc = await load(file);
      const needs = doc.jobs[job].needs ?? [];
      expect(needs, `${file}:${job} must need both gate jobs`).toContain('gates');
      expect(needs, `${file}:${job} must need both gate jobs`).toContain('e2e');
    }
  });

  test('the publish workflow gates the tag it publishes, not the branch', async () => {
    // A publish is dispatched with a TAG. Gating it against `main`'s tip would
    // verify a different commit than the one about to reach npm, and it is a
    // silent mistake: the gates pass, and the wrong tree was checked.
    const doc = await load('publish.yml');
    const checkout = (doc.jobs.publish.steps as Array<any>).find((step) => step.uses?.startsWith('actions/checkout'));
    expect(checkout?.with?.ref).toBeTruthy();
    for (const id of ['gates', 'e2e']) {
      // The SAME expression as the publish job's own checkout, so the ref that
      // is verified and the ref that is published cannot drift apart.
      expect(doc.jobs[id].with?.ref, `${id} gates a different ref than the publish checkout`).toBe(checkout.with.ref);
    }
  });
  test('both gates run on Windows as well as Linux', async () => {
    // The chamber ships a Windows CLI, and the win32 branches in its path
    // helpers, `stop`'s ownership guard and the process-tree kill are otherwise
    // never executed by any gate: the repository is developed on macOS and the
    // runners are Linux. Three of the last five commits on `main` are Windows
    // fixes that were written and verified on a Mac.
    //
    // Asserted rather than left to review because a runner removed from a job
    // is invisible: the job keeps passing on the platform that remained.
    for (const [file, jobs] of [
      ['gates.yml', ['checks', 'windows']],
      ['e2e-specs.yml', ['chromium', 'chromium-windows']],
    ] as const) {
      const doc = await load(file);
      // Bracket notation: `runs-on` contains a hyphen, so `doc.jobs[x].runs-on`
      // parses as a subtraction.
      const runners = jobs.map((id) => doc.jobs?.[id]?.['runs-on'] as string | undefined);
      expect(runners, `${file} must run on both Linux and Windows`).toContain('ubuntu-latest');
      expect(runners, `${file} must run on both Linux and Windows`).toContain('windows-latest');
    }
  });
});
