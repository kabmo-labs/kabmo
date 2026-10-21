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

/**
 * The publish BODIES, called by both their trigger file and `release.yml`.
 *
 * They are not gates themselves — they CALL the two gate workflows — but they
 * are the reason a release run now publishes instead of dispatching: a `uses:`
 * reference to one of these from `release.yml` is what makes publishing the
 * last action of the run rather than a second run beside it.
 *
 * `publish-android.yml` is the exception to "they call the gates": the APK is a
 * packaging step over a commit `release.yml` already gated, and it is only
 * reachable from there. The gate contract below therefore treats it as a body
 * that does NOT provide gates, and asserts that instead.
 */
const PUBLISH_BODIES = ['publish-app.yml', 'publish-packages.yml'];

/** The Android APK body: a publish body that is not an npm publish and not a gate. */
const ANDROID_BODY = 'publish-android.yml';

/** Every workflow that can tag or publish, and therefore must be gated. */
const RELEASING = ['release.yml', 'publish.yml', 'publish-plugins.yml'];

/** The trigger files, which call the reusable workflows they replace. */
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
    for (const file of ['gates.yml', 'e2e-specs.yml', ...PUBLISH_BODIES, ANDROID_BODY]) {
      expect(existsSync(join(WORKFLOWS, file))).toBe(true);
      const doc = await load(file);
      // `workflow_call` is what makes a file callable at all. Without it the
      // caller fails with "invalid value for uses", which no gate would catch.
      expect(doc.on?.workflow_call).toBeDefined();
    }
  });

  test('every local reusable-workflow reference resolves and declares workflow_call', async () => {
    const seen = new Set<string>();
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS), ...PUBLISH_BODIES, ANDROID_BODY]) {
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
    // Five: the two gates, the two npm publish bodies, and the Android APK body.
    expect(seen.size).toBe(5);
  });

  test('a caller passes only inputs the callee declares', async () => {
    // An input the callee does not declare is a run-time failure ("Invalid
    // input, ... is not defined in the referenced workflow"), and it is exactly
    // the kind of typo a rename produces.
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS), ...PUBLISH_BODIES, ANDROID_BODY]) {
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
    // A job is a GATE PROVIDER when it calls a gate workflow directly, or when
    // it calls one of the publish bodies (which call both gates themselves —
    // see `publish-app.yml`). The second form is how the publish bodies keep
    // the requirement uniform: a caller cannot forget a gate it does not name.
    const isProvider = (uses: unknown): boolean =>
      typeof uses === 'string' &&
      (uses === GATES || uses === E2E || PUBLISH_BODIES.some((body) => uses === `./.github/workflows/${body}`));

    for (const file of RELEASING) {
      const doc = await load(file);
      const jobs = doc.jobs ?? {};

      const gateProviders = new Set(
        Object.entries<any>(jobs)
          .filter(([, job]) => isProvider(job?.uses))
          .map(([id]) => id),
      );
      expect(gateProviders.size, `${file} reaches no gate from any job`).toBeGreaterThan(0);

      // A gate with a condition is a gate that can be skipped, which is not a
      // gate. `if:` is deliberately allowed nowhere on a job whose `uses` IS a
      // gate workflow. A job that calls a publish body may carry one —
      // publishing only when the release produced a tag is the point — because
      // the body's own gate jobs are unconditional.
      for (const id of gateProviders) {
        const uses = jobs[id]?.uses;
        if (uses !== GATES && uses !== E2E) continue;
        expect(jobs[id].if, `${file}:${id} is a gate job with an if: condition`).toBeUndefined();
      }

      // Transitive closure: every other job must reach a provider. This is the
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
        if (gateProviders.has(id)) continue;
        const needs = reach(id);
        const gated = [...needs].some((dep) => gateProviders.has(dep));
        expect(gated, `${file}:${id} does not depend on the gates`).toBe(true);
      }
    }
  });

  test('both gates run on Windows as well as Linux', async () => {
    // The Kabmo ships a Windows CLI, and the win32 branches in its path
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

  test('the app release waits for the packages, the plugin bumps and the shell bump', async () => {
    // The ordering is load-bearing and it is the one thing the transitive check
    // above cannot see: `app` could depend on the gates directly and still race
    // the lockfile refresh.
    //
    // The chain is `packages -> marketplace -> android -> app`, and every hop
    // matters. `packages` commits the refreshed `bun.lock`, and a `workspace:`
    // spec is substituted from that record, so the app must not pack before it.
    // `marketplace` bumps the bundled plugins' versions into the same branch, and
    // the app's tarball is what carries them. `android` bumps the shell version
    // into the same branch, and both release channels build from a tag that
    // carries it — so a bump landing after `app` would reach installs one
    // release late.
    const doc = await load('release.yml');
    const needsOf = (id: string): string[] => {
      const value = doc.jobs[id]?.needs;
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    };

    expect(needsOf('marketplace')).toContain('packages');
    expect(needsOf('android')).toContain('marketplace');
    expect(needsOf('app')).toContain('android');

    // The shell's own release also waits for `app`: its APK must carry the shell
    // version the bump wrote, and a tag cut before the bump commit landed would
    // build the previous one.
    expect(needsOf('shell-release')).toContain('app');
  });

  test('the shell bump runs before the app tags, and only writes its own version file', async () => {
    // A bump that ran after the app would be discarded (the release commit
    // carries only semantic-release's own assets) and the APK would be built
    // from a tag holding the OLD shell version — a fix no installed app is ever
    // offered. The commit step's file list is asserted because staging `-A` would
    // sweep a lockfile change into a `chore` that claims to be a version bump.
    const doc = await load('release.yml');
    const job = doc.jobs.android;
    expect(job, 'release.yml has no android bump job').toBeDefined();

    const steps = (job.steps as Array<{ run?: string; name?: string }>) ?? [];
    const bump = steps.findIndex((step) => String(step.run ?? '').includes('release-android.mjs'));
    const commit = steps.findIndex((step) => String(step.run ?? '').includes('git commit'));
    expect(bump, 'the shell bump must run its own script').toBeGreaterThanOrEqual(0);
    expect(commit, 'the bump must be committed, or the tag builds the old version').toBeGreaterThan(bump);

    const text = JSON.stringify(steps);
    expect(text, 'the bump commit must stage only version.properties').toContain(
      'git add packages/android/version.properties',
    );
  });

  test('nothing publishes before the gates in a publish workflow', async () => {
    // Every publish body's own publish job must need both gate jobs. A release
    // run reaches these through `release.yml`, but a tag push and a manual
    // re-run reach them directly — and a publish that skipped the gates would
    // ship bytes nothing verified.
    for (const file of PUBLISH_BODIES) {
      const doc = await load(file);
      const needs = doc.jobs.publish.needs ?? [];
      expect(needs, `${file}:publish must need both gate jobs`).toContain('gates');
      expect(needs, `${file}:publish must need both gate jobs`).toContain('e2e');
      // `always()` is required, not decoration: a skipped job in `needs` makes
      // the dependent job skip by default, which would turn the `run-gates:
      // false` path into "publish nothing" — a silent no-op instead of a
      // release. The result checks keep a FAILED gate blocking the publish.
      const condition = String(doc.jobs.publish.if ?? '');
      expect(condition, `${file}:publish must run when its gates are skipped`).toContain('always()');
      expect(condition, `${file}:publish must still refuse a failed gate`).toContain("needs.gates.result == 'success'");
    }
  });

  test('a release does not re-gate the commit it already verified', async () => {
    // The release run's own `gates`/`e2e` jobs verify the pushed commit. The tag
    // it publishes differs from that commit by release METADATA only — measured
    // on v4.18.2: CHANGELOG.md, the version field, and one bundled plugin's
    // manifest, with no code among them. Re-running the browser matrix on that
    // delta buys no coverage and costs a release when it flakes, which is what
    // happened: v4.18.2 was tagged and never reached npm because an unrelated
    // test's teardown tripped inside the publish job's own gate run.
    const doc = await load('release.yml');
    for (const id of ['app-publish', 'packages-publish']) {
      expect(
        doc.jobs[id].with?.['run-gates'],
        `release.yml:${id} must not re-gate what this run already gated`,
      ).toBe(false);
    }
    // The trigger files keep the gates ON, because a hand-pushed tag was never
    // verified by anything.
    for (const [file, id] of [['publish.yml', 'publish'], ['publish-plugins.yml', 'publish']] as const) {
      const trigger = await load(file);
      const called = String(trigger.jobs[id].uses);
      const body = await load(called.replace('./.github/workflows/', ''));
      const runGates = body.on?.workflow_call?.inputs?.['run-gates'];
      expect(runGates?.default, `${file}: the gate opt-out must default to running them`).toBe(true);
    }
  });

  test('the app publish gates the tag it publishes, not the branch', async () => {
    // A publish names a TAG. Gating it against `main`'s tip would verify a
    // different commit than the one about to reach npm, and it is a silent
    // mistake: the gates pass, and the wrong tree was checked.
    //
    // The expression is `inputs.tag || github.sha` in BOTH the checkout and the
    // two gate calls, so the ref that is verified and the ref that is published
    // cannot drift apart — and the `|| github.sha` fallback is what a
    // `workflow_dispatch` with no tag wants (see `publish.yml`, which passes an
    // empty string in that case).
    const doc = await load('publish-app.yml');
    const checkout = (doc.jobs.publish.steps as Array<any>).find((step) => step.uses?.startsWith('actions/checkout'));
    const expected = '${{ inputs.tag || github.sha }}';
    expect(checkout?.with?.ref).toBe(expected);
    for (const id of ['gates', 'e2e']) {
      expect(doc.jobs[id].with?.ref, `${id} gates a different ref than the publish checkout`).toBe(expected);
    }
  });

  test('a release PUBLISHES instead of dispatching, and only after it tagged', async () => {
    // The point of folding the publish into the release run: `release.yml`
    // calls both publish bodies itself, so the run that cut a tag is the run
    // that publishes it and is not finished until npm has it. A `gh workflow
    // run` dispatch — what this replaced — starts a SEPARATE run, so the
    // release could report success while its publish was still queued, still
    // waiting on the `npm` environment, or already failed.
    const doc = await load('release.yml');
    const jobs = doc.jobs ?? {};

    const appPublish = jobs['app-publish'];
    const packagesPublish = jobs['packages-publish'];
    expect(appPublish?.uses, 'app-publish must call the app publish body').toBe('./.github/workflows/publish-app.yml');
    expect(packagesPublish?.uses, 'packages-publish must call the packages publish body').toBe(
      './.github/workflows/publish-packages.yml',
    );

    // Neither may be conditional on anything but a release having happened, and
    // each must wait for the job that produced its tag.
    expect(appPublish.needs, 'app-publish must wait for the app release').toContain('app');
    expect(packagesPublish.needs, 'packages-publish must wait for the packages release').toContain('packages');

    // The packages publish MUST name `ref: main`, and this is not a
    // convenience: the `packages` job commits the version bump and the
    // refreshed `bun.lock` to the BRANCH, so the manifests on the commit this
    // run was triggered by still carry the old versions — the publish script
    // would skip every package as already published and report success having
    // published nothing. `main` resolves against the remote, so it lands on the
    // bump.
    expect(packagesPublish.with?.ref, 'packages-publish must publish from main, past the bump commit').toBe('main');

    // The app publish names the TAG the release job cut, not a branch.
    expect(appPublish.with?.tag).toBe('${{ needs.app.outputs.tag }}');
  });
});
