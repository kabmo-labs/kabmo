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
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
 * `publish-android.yml` is the exception to "they call the gates": the APK is
 * built and verified in a job that `app` DEPENDS on — so it gates the release —
 * but it does not call the two gate workflows itself, and it is only reachable
 * from `release.yml` (or a manual dispatch that names an existing release). The
 * gate contract below therefore treats it as a body that does NOT provide gates,
 * and asserts the `needs:` chain that makes its build a gate instead.
 */
const PUBLISH_BODIES = ['publish-app.yml', 'publish-packages.yml'];

/**
 * The Android APK body: not an npm publish and not a gate provider, but its
 * `build` phase IS a gate on `app` — `app` `needs: apk-build`, so a release is
 * never tagged from a tree whose shell could not be built.
 */
const ANDROID_BODY = 'publish-android.yml';

/**
 * The iOS IPA body: the same shape as the Android one, and the same contract — its
 * `build` phase is a gate on `app` (`app` `needs: ipa-build`), so a release is never
 * tagged from a tree whose shell could not be built. It is macOS-only, because the
 * iOS SDK ships with Xcode and no Linux runner has it.
 */
const IOS_BODY = 'publish-ios.yml';

/**
 * The macOS app body: the third shell, and the same contract as the two mobile
 * ones — its `build` phase is a gate on `app` (`app` `needs: macos-build`). It
 * builds BOTH architectures, each on the macOS image that IS that architecture:
 * `macos-15` (Apple silicon) and `macos-15-intel`.
 */
const MACOS_BODY = 'publish-macos.yml';

/**
 * The Windows app body: the same contract as the two mobile ones — its `build`
 * phase is a gate on `app` (`app` `needs: win-build`). It builds BOTH
 * architectures natively: `x64` on `windows-latest` and `arm64` on
 * `windows-11-arm`, which also carries the .NET 8 SDK and Inno Setup 6.
 */
const WINDOWS_BODY = 'publish-windows.yml';

/**
 * The Linux app body: the fourth shell, same contract again — its `build` phase is
 * a gate on `app` (`app` `needs: linux-build`). It builds BOTH architectures
 * natively, on the images that carry the GTK 3 and WebKitGTK 4.1 development
 * packages for each: `ubuntu-latest` (x64) and `ubuntu-24.04-arm`.
 */
const LINUX_BODY = 'publish-linux.yml';

/**
 * Every workflow that can tag or publish, and therefore must be gated.
 *
 * `publish-github-packages.yml` is here even though it is a MANUAL dispatch and
 * never a release step: it can put a package on a registry, and "gated" is a
 * property of what a workflow can do rather than of what triggers it.
 */
const RELEASING = ['release.yml', 'publish.yml', 'publish-plugins.yml', 'publish-github-packages.yml'];

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
    for (const file of ['gates.yml', 'e2e-specs.yml', ...PUBLISH_BODIES, ANDROID_BODY, IOS_BODY, MACOS_BODY, WINDOWS_BODY, LINUX_BODY]) {
      expect(existsSync(join(WORKFLOWS, file))).toBe(true);
      const doc = await load(file);
      // `workflow_call` is what makes a file callable at all. Without it the
      // caller fails with "invalid value for uses", which no gate would catch.
      expect(doc.on?.workflow_call).toBeDefined();
    }
  });

  test('every local reusable-workflow reference resolves and declares workflow_call', async () => {
    const seen = new Set<string>();
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS), ...PUBLISH_BODIES, ANDROID_BODY, IOS_BODY, MACOS_BODY, WINDOWS_BODY, LINUX_BODY]) {
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
    // Nine: the two gates, the two npm publish bodies, and the four shell bodies
    // (Android APK, iOS IPA, macOS app, Linux app).
    expect(seen.size).toBe(9);
  });

  test('a caller passes only inputs the callee declares', async () => {
    // An input the callee does not declare is a run-time failure ("Invalid
    // input, ... is not defined in the referenced workflow"), and it is exactly
    // the kind of typo a rename produces.
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS), ...PUBLISH_BODIES, ANDROID_BODY, IOS_BODY, MACOS_BODY, WINDOWS_BODY, LINUX_BODY]) {
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

  test('every caller grants the permissions its callee declares', async () => {
    // A reusable workflow's permission CEILING is validated against the WHOLE
    // callee file, at PARSE time, before any job or `if:` is considered — and a
    // violation is not a failed job, it is `startup_failure` for the entire run:
    // no job starts, no log is produced, and the only place the reason exists is
    // the run page's annotation. Measured on run 39681067473:
    //
    //   The nested job 'attach' is requesting 'contents: write',
    //   but is only allowed 'contents: read'.
    //
    // caused by `release.yml:apk-build` granting `contents: read` to a body
    // that also declares an `attach` job with `contents: write`. Nothing in this
    // repository caught it, because every other assertion here reads `needs:`
    // and `with:` — the permission block is not part of either.
    //
    // The rule is the platform's, not a preference: a caller may only DOWNGRADE
    // what it holds, and the callee's declared `write` must therefore be
    // matched. A caller that declares no `permissions:` block inherits the
    // default (which includes `contents: write`), so it is never a violation.
    const WRITE = 'write';
    for (const file of [...RELEASING, ...Object.keys(TRIGGERS), ...PUBLISH_BODIES, ANDROID_BODY, IOS_BODY, MACOS_BODY, WINDOWS_BODY, LINUX_BODY]) {
      const doc = await load(file);
      for (const [id, job] of Object.entries<any>(doc.jobs ?? {})) {
        const uses = job?.uses;
        if (typeof uses !== 'string' || !uses.startsWith('./')) continue;
        const callee = await load(uses.replace('./.github/workflows/', ''));
        const granted = job.permissions;
        for (const [calleeJob, entry] of Object.entries<any>(callee.jobs ?? {})) {
          for (const [scope, level] of Object.entries<any>(entry?.permissions ?? {})) {
            if (level !== WRITE) continue;
            // No block at all inherits the workflow default, which is a superset
            // of every scope a release needs.
            if (!granted) continue;
            expect(
              granted[scope],
              `${file}:${id} grants ${scope}: ${granted[scope] ?? 'none'} but ${uses}:${calleeJob} declares ${scope}: write`,
            ).toBe(WRITE);
          }
        }
      }
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

  test('the app release waits for the packages, the plugin bumps and the shell bumps', async () => {
    // The ordering is load-bearing and it is the one thing the transitive check
    // above cannot see: `app` could depend on the gates directly and still race
    // the lockfile refresh.
    //
    // The graph is `packages -> marketplace -> shells -> {apk-build, ipa-build,
    // win-build, macos-build, linux-build} -> app`, and every hop matters.
    // `packages` commits the refreshed `bun.lock`, and a `workspace:` spec is
    // substituted from that record, so the app must not pack before it.
    // `marketplace` bumps the bundled plugins' versions into the same branch, and
    // the app's tarball is what carries them. `shells` bumps every shell version
    // into ONE commit, the five builds compile it — and each is a GATE, because a
    // release tagged while a shell cannot be built is a release that ships
    // without it.
    const doc = await load('release.yml');
    const needsOf = (id: string): string[] => {
      const value = doc.jobs[id]?.needs;
      if (value === undefined) return [];
      return Array.isArray(value) ? value : [value];
    };

    expect(needsOf('marketplace')).toContain('packages');
    expect(needsOf('shells')).toContain('marketplace');
    for (const build of ['apk-build', 'ipa-build', 'win-build', 'macos-build', 'linux-build']) {
      expect(needsOf(build), `${build} must wait for the shell bumps`).toContain('shells');
    }

    // ONE bump job, not five. A shell that kept its own job would bring back a
    // checkout, an install, a push and a commit per shell — the history this
    // grouping exists to shorten.
    for (const gone of ['android', 'ios', 'windows', 'macos', 'linux']) {
      expect(doc.jobs[gone], `release.yml must not keep a separate ${gone} bump job`).toBeUndefined();
    }

    expect(needsOf('app')).toContain('apk-build');
    expect(needsOf('app')).toContain('ipa-build');
    expect(needsOf('app')).toContain('win-build');
    expect(needsOf('app')).toContain('macos-build');
    expect(needsOf('app')).toContain('linux-build');

    // The three attach jobs are the only ones allowed to hang off `app` alone: they
    // upload to the release `app` created, so they cannot run earlier, and their own
    // `if:` keeps a no-release run from calling them at all.
    expect(needsOf('apk')).toEqual(['app']);
    expect(needsOf('ipa')).toEqual(['app']);
    expect(needsOf('windows-app')).toEqual(['app']);
    expect(needsOf('macos-app')).toEqual(['app']);
    expect(needsOf('linux-app')).toEqual(['app']);
  });

  test('the shell bumps are ONE job and ONE commit, before the app tags', async () => {
    // A bump that ran after the app would be discarded (the release commit
    // carries only semantic-release's own assets) and every artifact would be
    // built from a tree holding the OLD shell versions — a fix no installed app
    // is ever offered. The staged file list is asserted because staging `-A`
    // would sweep a lockfile change into a `chore` that claims to be a version
    // bump, and because naming all five files in ONE commit is the point of
    // grouping the shells.
    const doc = await load('release.yml');
    const job = doc.jobs.shells;
    expect(job, 'release.yml has no shells bump job').toBeDefined();

    const steps = (job.steps as Array<{ run?: string; name?: string }>) ?? [];
    const bump = steps.findIndex((step) => String(step.run ?? '').includes('release-shells.mjs'));
    const commit = steps.findIndex((step) => String(step.run ?? '').includes('git commit'));
    expect(bump, 'the shell bumps must run through the one catalog runner').toBeGreaterThanOrEqual(0);
    expect(commit, 'the bumps must be committed, or the tag builds the old versions').toBeGreaterThan(bump);

    const text = JSON.stringify(steps);
    for (const shell of ['android', 'ios', 'windows', 'macos', 'linux']) {
      expect(text, `the one bump commit must stage ${shell}'s version file`).toContain(
        `packages/${shell}/version.properties`,
      );
    }

    // Exactly one commit: a second one is the per-shell commits coming back.
    expect(String(steps[commit].run).match(/git commit/g), 'the shells must share ONE commit').toHaveLength(
      1,
    );
    expect(String(steps[commit].run), 'the commit must name every bumped shell').toContain(
      'chore(release): bump the shells (',
    );
  });

  test('the macOS app is BUILT before the app tags, and only attached after', async () => {
    // The third shell, and the same contract as the APK and the IPA: a build
    // failure must stop the release BEFORE a tag exists, so a release never goes
    // out with no app attached. `publish-macos.yml` also verifies the version the
    // bundle declares, which is the macOS-specific failure — a plist that
    // disagrees with `version.properties` publishes an app whose own About panel
    // names a different build than its download.
    const doc = await load('release.yml');
    const build = doc.jobs['macos-build'];
    const attach = doc.jobs['macos-app'];

    expect(build, 'release.yml has no macos-build job').toBeDefined();
    expect(build.uses, 'release.yml:macos-build must call the macOS body').toBe(
      `./.github/workflows/${MACOS_BODY}`,
    );
    expect(build.with?.mode, 'macos-build must build').toBe('build');
    expect(build.needs, 'the macOS build must come after the shell bumps').toContain('shells');
    expect(doc.jobs.app.needs, 'the app must not tag unless the macOS app built').toContain('macos-build');

    // The build compiles from `main`, not the trigger commit: the bump just landed
    // there, and the starting commit declares the OLD version.
    expect(build.with?.ref, 'the macOS build must compile the bumped branch').toBe('main');

    expect(attach?.uses, 'release.yml:macos-app must call the macOS body').toBe(
      `./.github/workflows/${MACOS_BODY}`,
    );
    expect(attach.with?.mode, 'the post-tag job must not rebuild the app').toBe('attach');
    expect(attach.needs, 'release.yml:macos-app must wait for the app release').toContain('app');
    expect(attach.with?.tag).toBe('${{ needs.app.outputs.tag }}');

    // The body itself: a macOS runner PER architecture, the version read from the
    // properties file and verified on the assembled bundle, and an archive that
    // keeps the signature (`ditto`, never `zip`).
    const body = await load(MACOS_BODY);
    const steps = (body.jobs.build.steps as Array<{ run?: string }>) ?? [];
    const text = JSON.stringify(steps);
    // `runs-on` is `${{ matrix.runner }}` now, so the platform is a fact about the
    // MATRIX: a single-arch body would still pass a `contains('macos')` test while
    // handing one Mac family an app it cannot launch.
    const runners = (body.jobs.build.strategy?.matrix?.include ?? []).map(
      (row: { runner?: string }) => row.runner ?? '',
    );
    expect(runners.length, 'the macOS body must build both architectures').toBe(2);
    for (const runner of runners) {
      expect(runner, 'every macOS matrix row must run on a macOS image').toContain('macos');
    }
    expect(runners, 'one row must be Apple silicon').toContain('macos-15');
    expect(runners, 'one row must be Intel').toContain('macos-15-intel');
    expect(text, 'the body must read the version from version.properties').toContain(
      'release/macos-version.mjs',
    );
    expect(text, 'the body must verify the bundle version').toContain('CFBundleShortVersionString');
    expect(text, 'the body must package with ditto, or the signature is stripped').toContain('ditto');
    expect(text, 'the body must run the logic suite').toContain('kabmo-desktop-tests');
    expect(text, 'the body must run the window suite').toContain('kabmo-desktop-window-tests');
  });

  test('the Linux app is BUILT before the app tags, and only attached after', async () => {
    // The fourth shell, same contract as the APK, the IPA and the macOS app: a Rust
    // error, a missing GTK/WebKitGTK development package or a rules-suite failure
    // must stop the release BEFORE a tag exists. `publish-linux.yml` also verifies
    // the version the BINARY reports — `build.rs` bakes `version.properties` into
    // it, so a build reading a stale file publishes a shell whose page shows a
    // number the pipeline never released.
    const doc = await load('release.yml');
    const build = doc.jobs['linux-build'];
    const attach = doc.jobs['linux-app'];

    expect(build, 'release.yml has no linux-build job').toBeDefined();
    expect(build.uses, 'release.yml:linux-build must call the Linux body').toBe(
      `./.github/workflows/${LINUX_BODY}`,
    );
    expect(build.with?.mode, 'linux-build must build').toBe('build');
    expect(build.needs, 'the Linux build must come after the shell bumps').toContain('shells');
    expect(doc.jobs.app.needs, 'the app must not tag unless the Linux app built').toContain(
      'linux-build',
    );

    // `main`, not the trigger commit: the bump just landed there, and `build.rs`
    // bakes that number in.
    expect(build.with?.ref, 'the Linux build must compile the bumped branch').toBe('main');

    expect(attach?.uses, 'release.yml:linux-app must call the Linux body').toBe(
      `./.github/workflows/${LINUX_BODY}`,
    );
    expect(attach.with?.mode, 'the post-tag job must not rebuild the app').toBe('attach');
    expect(attach.needs, 'release.yml:linux-app must wait for the app release').toContain('app');
    expect(attach.with?.tag).toBe('${{ needs.app.outputs.tag }}');

    // The body itself: the native libraries, the rules suite, and the installer.
    // The platform is a fact about the MATRIX (see the macOS note): both rows must
    // be Linux, and one of them must be the Arm64 image — an x64-only body would
    // otherwise ship no archive an Arm machine can run.
    const body = await load(LINUX_BODY);
    const runners = (body.jobs.build.strategy?.matrix?.include ?? []).map(
      (row: { runner?: string }) => row.runner ?? '',
    );
    expect(runners.length, 'the Linux body must build both architectures').toBe(2);
    for (const runner of runners) {
      expect(runner, 'every Linux matrix row must run on a Linux image').toContain('ubuntu');
    }
    expect(runners, 'one row must be the Arm64 image').toContain('ubuntu-24.04-arm');
    const text = JSON.stringify(body.jobs.build.steps as Array<{ run?: string }>);
    expect(text, 'the body must install the GTK and WebKitGTK packages').toContain(
      'libwebkit2gtk-4.1-dev',
    );
    expect(text, 'the body must install the entry validator').toContain('desktop-file-utils');
    expect(text, 'the body must run the rules suite').toContain('kabmo-desktop-tests');
    expect(text, 'the body must read the version from version.properties').toContain(
      'release/linux-version.mjs',
    );
    expect(text, 'the body must verify the built binary carries that version').toContain(
      'the binary reports',
    );
    // The binary is named after the APP: GTK takes the process name, `WM_CLASS` and
    // the taskbar label from the executable's file name, so `kabmo-desktop` put that
    // string in the window list on a shell whose own title says Kabmo.
    expect(text, 'the body must verify the app-named binary').toContain('$out/Kabmo');
    // The installer is the thing a user runs, so the workflow RUNS it into a
    // throwaway prefix instead of only checking that the file exists — that is what
    // catches a template placeholder the script stopped filling in.
    expect(text, 'the body must run the installer').toContain('$out/install.sh');
    expect(text, 'the body must check the installed binary').toContain('$prefix/bin/Kabmo');
    expect(text, 'the body must validate the entry the installer wrote').toContain(
      'desktop-file-validate',
    );
    expect(text, 'the body must remove it again').toContain('--uninstall');
    // The archive unpacks to `Kabmo/`, so the download is not a crate name.
    expect(text, 'the archive must carry the app-named directory').toMatch(
      /tar -C packages\/linux\/build -czf .* Kabmo/,
    );
  });

  /**
   * The launcher entry, generated for real.
   *
   * `install.sh` writes `Exec=` from `kabmo.desktop.in` with the prefix it just
   * chose, and the release body greps that line. The two drifted once already:
   * the entry gained `%F` (the file argument that makes Kabmo a document
   * handler) while the grep still demanded the whole line be the bare path, so
   * both Linux rows went red on a release whose gates were green — the drift is
   * invisible until the packaging step runs, which is only on a release.
   *
   * This runs the installer into a throwaway prefix, the way the body does, so
   * the template, the substitution and the specifier are exercised together.
   * POSIX-only: the installer is bash.
   */
  test.skipIf(process.platform === 'win32')(
    'the installer writes an Exec line naming the binary and taking files',
    () => {
      const scripts = join(ROOT, 'packages/linux/scripts');
      const app = mkdtempSync(join(tmpdir(), 'kabmo-launcher-'));
      const prefix = mkdtempSync(join(tmpdir(), 'kabmo-prefix-'));
      try {
        // What the release archive carries beside the script: the binary, the
        // icon, and the MIME list `build-app.sh` generates.
        writeFileSync(join(app, 'Kabmo'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        writeFileSync(join(app, 'kabmo.png'), '');
        writeFileSync(join(app, 'mime-types.txt'), 'application/pdf;\n');
        // The archive carries the licence notice, and `install.sh` refuses to run
        // without it — so the fixture is the archive, not a subset of it.
        copyFileSync(join(ROOT, 'LICENSE'), join(app, 'LICENSE'));
        for (const name of ['install.sh', 'kabmo.desktop.in']) {
          copyFileSync(join(scripts, name), join(app, name));
        }
        const run = Bun.spawnSync(['bash', join(app, 'install.sh')], {
          env: { ...process.env, PREFIX: prefix },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(run.exitCode, run.stderr.toString()).toBe(0);

        const entry = readFileSync(join(prefix, 'share/applications/kabmo.desktop'), 'utf8');
        const exec = entry.split('\n').find((line) => line.startsWith('Exec='));
        // The binary is QUOTED (a prefix may contain a space) and `%F` follows it:
        // the same two facts the release body asserts with `grep -qx`.
        expect(exec).toBe(`Exec="${join(prefix, 'bin', 'Kabmo')}" %F`);
        expect(entry).toContain('MimeType=application/pdf;');

        // The MIT notice is installed with the app, byte for byte: the licence
        // requires it in every copy, and a trimmed or rewritten notice is not the
        // notice. `--uninstall` then removes it, so a removed app leaves no claim
        // behind in the prefix.
        const licence = join(prefix, 'share/doc/kabmo/LICENSE');
        expect(readFileSync(licence, 'utf8')).toBe(readFileSync(join(ROOT, 'LICENSE'), 'utf8'));

        const removed = Bun.spawnSync(['bash', join(app, 'install.sh'), '--uninstall'], {
          env: { ...process.env, PREFIX: prefix },
          stdout: 'pipe',
          stderr: 'pipe',
        });
        expect(removed.exitCode, removed.stderr.toString()).toBe(0);
        expect(existsSync(licence)).toBe(false);
      } finally {
        rmSync(app, { recursive: true, force: true });
        rmSync(prefix, { recursive: true, force: true });
      }
    },
  );

  test('the IPA is BUILT before the app tags, and only attached after', async () => {
    // The iOS twin of the APK rule, and it exists for the same failure: a shell built
    // AFTER the tag means a Swift error leaves a release already published with no
    // shell attached. Building first makes the IPA a GATE on `app`.
    const doc = await load('release.yml');
    const build = doc.jobs['ipa-build'];
    const attach = doc.jobs.ipa;

    expect(build, 'release.yml has no ipa-build job').toBeDefined();
    expect(build.uses, 'release.yml:ipa-build must call the IPA body').toBe(
      `./.github/workflows/${IOS_BODY}`,
    );
    expect(build.with?.mode, 'ipa-build must build').toBe('build');
    // One grouped bump job, so the IPA waits on that single edge instead of a
    // chain of per-shell jobs — reachability, not a direct edge.
    expect(build.needs, 'the IPA build must wait for the shell bumps').toContain('shells');
    expect(doc.jobs.app.needs, 'the app must not tag unless the IPA built').toContain('ipa-build');

    expect(attach?.uses, 'release.yml:ipa must call the IPA body').toBe(`./.github/workflows/${IOS_BODY}`);
    expect(attach.with?.mode, 'the post-tag job must not rebuild the IPA').toBe('attach');
    expect(attach.needs, 'release.yml:ipa must wait for the app release').toContain('app');
    expect(attach.with?.tag).toBe('${{ needs.app.outputs.tag }}');

    // The bundle's CFBundleVersion must move, for the same reason the APK's
    // versionCode must: the store refuses a build whose number does not increase. It
    // is stated at BUILD time and nowhere else.
    expect(build.with?.['build-number'], 'the bundle build number must move every release').toBe(
      '${{ github.run_number }}',
    );
    expect(attach.with?.['build-number'], 'the attach must not restate the build number').toBeUndefined();

    // The bundle must declare the BUMPED version, so it compiles from the branch the
    // bump landed on rather than the commit this run was triggered by.
    expect(build.with?.ref, 'the IPA must build the bumped shell version').toBe('main');

    // The body needs the iOS SDK, which only a macOS runner has.
    const body = await load(IOS_BODY);
    expect(body.jobs.build['runs-on'], 'the IPA body must run on macOS').toContain('macos');

    // The logic suite runs there, not in `gates.yml`: a pull request must not pay for
    // the Apple toolchain.
    const buildText = JSON.stringify(body.jobs.build.steps as Array<any>);
    expect(buildText, 'the IPA body must run the logic tests').toContain('swift run kabmo-shell-tests');
    expect(buildText, 'the IPA body must not publish to npm').not.toContain('npm publish');
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

  test('the APK is BUILT before the app tags, and only attached after', async () => {
    // The shell is a private application: there is no registry for it, and the
    // only artifact is the `.apk` on the GitHub release. The failure this test
    // exists for is the one that shipped: the APK used to be built AFTER `app`
    // tagged, so a build failure (measured — the SDK's `tools` package was
    // removed, and setup died before Gradle ran) left a release that was already
    // tagged and published with no shell attached, repaired only by a hand-run
    // dispatch. Building before the tag makes the APK a GATE on the release.
    const doc = await load('release.yml');
    const build = doc.jobs['apk-build'];
    const apk = doc.jobs.apk;

    //   1. the build runs BEFORE `app`, and `app` waits for it;
    expect(build, 'release.yml has no apk-build job').toBeDefined();
    expect(build.uses, 'release.yml:apk-build must call the APK body').toBe(
      `./.github/workflows/${ANDROID_BODY}`,
    );
    expect(build.with?.mode, 'apk-build must build').toBe('build');
    // One grouped bump job: the APK build waits on that single edge, which is
    // what carries the bumped Android version into the tree it compiles.
    expect(build.needs, 'the APK build must come after the shell bumps').toContain('shells');
    expect(doc.jobs.app.needs, 'the app must not tag unless the APK built').toContain('apk-build');

    //   2. the attach runs AFTER `app`, because `gh release upload` needs the
    //      release to exist — running first would 404;
    expect(apk?.uses, 'release.yml:apk must call the APK body').toBe(`./.github/workflows/${ANDROID_BODY}`);
    expect(apk.with?.mode, 'the post-tag job must not rebuild the APK').toBe('attach');
    expect(apk.needs, 'release.yml:apk must wait for the app release').toContain('app');
    expect(apk.with?.tag).toBe('${{ needs.app.outputs.tag }}');

    //   3. Android refuses an install whose versionCode does not increase, so a
    //      fixed value would make every release after the first uninstallable
    //      over the previous one. It is stated at BUILD time, on the run number,
    //      and nowhere else — the attach uploads a file that already carries it.
    expect(build.with?.['version-code'], 'the APK versionCode must move every release').toBe(
      '${{ github.run_number }}',
    );
    expect(apk.with?.['version-code'], 'the attach must not restate the versionCode').toBeUndefined();

    //   4. the build compiles from the branch the shell bump landed on, not the
    //      commit this run was triggered by — otherwise the APK declares the
    //      PREVIOUS shell version and no installed app is offered it.
    expect(build.with?.ref, 'the APK must build the bumped shell version').toBe('main');

    //   5. it asks for no npm publish, so nothing about it can drift into one.
    const body = await load(ANDROID_BODY);
    expect(body.jobs.build.environment, 'the APK body must not join the npm environment').toBeUndefined();
    const steps = body.jobs.build.steps as Array<{ run?: string; uses?: string; env?: Record<string, string> }>;
    const text = JSON.stringify(steps);
    expect(text, 'the APK body must not publish to npm').not.toContain('npm publish');
    expect(text, 'the APK body must not read NPM_TOKEN').not.toContain('NPM_TOKEN');

    //   6. the attach uploads and never compiles — a compile in the post-tag job
    //      is the failure this split removes, and it would also attach a
    //      different binary than the one the checks in `build` verified.
    const attachText = JSON.stringify(body.jobs.attach.steps as Array<any>);
    expect(attachText, 'the attach must upload to the GitHub release').toContain('gh release upload');
    expect(attachText, 'the attach must not run Gradle').not.toContain('gradlew');

    //   6b. `gh` needs a repository CONTEXT, and the attach checks nothing out —
    //      its only input is the artifact it downloads. `gh` resolves the repo
    //      from a git remote in the working directory, so without `GH_REPO`
    //      every command there dies with `fatal: not a git repository`, and the
    //      `||` guard reports it as "No GitHub release for <tag>" — a wrong
    //      reason for a real failure. Measured on run 39690728834: the release
    //      existed and was empty while the artifact sat in the same run, so the
    //      release shipped with no shell for the second time, for a new reason.
    const attachStep = (body.jobs.attach.steps as Array<any>).find((step) =>
      String(step.run ?? '').includes('gh release upload'),
    );
    expect(attachStep, 'the attach must have a step that uploads').toBeDefined();
    expect(
      attachStep?.env?.GH_REPO,
      'the attach must name the repository: it checks nothing out, so gh has no remote to read',
    ).toBeDefined();
    // A checkout would also work, and would be slower; either way the job must
    // not depend on a working directory it never created.
    const attachUsesCheckout = (body.jobs.attach.steps as Array<any>).some((step) =>
      String(step.uses ?? '').includes('actions/checkout'),
    );
    expect(
      attachUsesCheckout || attachStep?.env?.GH_REPO,
      'the attach needs either a checkout or GH_REPO',
    ).toBeTruthy();

    //   7. the artifact NAME is a literal both phases read, never an input.
    //      It was an input with a default, which is empty on a
    //      `workflow_dispatch` — the dispatch path declares no such input, so
    //      `inputs.artifact-name` resolves to `''` and the download matches
    //      nothing while the upload wrote a named artifact. A repair dispatch
    //      would build an APK and attach none of it, silently.
    const artifactStep = (steps: Array<any>) =>
      steps.find((step) => String(step.uses ?? '').includes('artifact'));
    const buildArtifact = artifactStep(body.jobs.build.steps as Array<any>);
    const attachArtifact = artifactStep(body.jobs.attach.steps as Array<any>);
    expect(String(buildArtifact?.uses), 'the build must upload the APK as a run artifact').toContain(
      'upload-artifact',
    );
    expect(String(attachArtifact?.uses), 'the attach must download that artifact').toContain(
      'download-artifact',
    );
    expect(buildArtifact?.with?.name, 'the two phases must name the same artifact').toBe(
      attachArtifact?.with?.name,
    );
    expect(String(buildArtifact?.with?.name), 'the artifact name must not be an input').not.toContain('inputs.');
  });

  test('the APK is built from the branch the shell bump landed on', async () => {
    // The tag, never the branch, was the old rule — because the APK was built
    // after `app`. Now the build happens BEFORE the tag exists, so it names the
    // branch that carries the bump; the attach names the tag. Checking out the
    // trigger commit would build the previous shell version.
    //
    // The dispatch fallback is the TAG, so a hand-run repair builds the tree the
    // release names rather than whatever `main` says today — the whole reason
    // `publish-android.yml` keeps its own `workflow_dispatch` at all.
    const body = await load(ANDROID_BODY);
    const checkout = (body.jobs.build.steps as Array<{ uses?: string; with?: Record<string, string> }>).find((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    expect(checkout?.with?.ref, 'the APK build must name the ref it was given').toBe(
      '${{ inputs.ref || inputs.tag || github.sha }}',
    );
  });

  test('every attach step names GH_REPO, because it checks nothing out', async () => {
    // The attach jobs download an artifact and upload it, so they deliberately
    // check nothing out — and `gh` needs a repository to talk to. Without
    // `GH_REPO` it dies with "failed to run git: fatal: not a git repository",
    // which names the checkout it is not doing rather than the upload that never
    // happened. Measured on `publish-windows.yml` for `v0.6.0`: the artifact
    // downloaded, `ls -l ./*.exe` printed, and the job failed before
    // `gh release upload` ran at all.
    //
    // Asserted on the ENV of every step that runs `gh release upload`, in every
    // shell body, so a new one cannot ship without it.
    const bodies = [ANDROID_BODY, IOS_BODY, MACOS_BODY, WINDOWS_BODY, LINUX_BODY];
    let checked = 0;
    for (const file of bodies) {
      const doc = await load(file);
      const steps = Object.values<any>(doc.jobs ?? {}).flatMap(
        (job) => (job?.steps as Array<{ run?: string; env?: Record<string, string> }>) ?? [],
      );
      for (const step of steps) {
        if (!step.run?.includes('gh release upload')) continue;
        checked += 1;
        expect(step.env?.GH_REPO, `${file}: a 'gh release upload' step has no GH_REPO`).toBe(
          '${{ github.repository }}',
        );
      }
    }
    // The assertion is vacuous if the search stopped matching — a renamed command
    // would make every body pass while uploading nothing.
    expect(checked, 'no gh release upload step was found in any shell body').toBeGreaterThanOrEqual(5);
  });
});
