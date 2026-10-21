/**
 * The two release channels the Android APK can ride, asserted on the YAML graph.
 *
 * Split out of `tests/ci-gates.test.ts` when that file reached its size ceiling.
 * The subject is a different question from the gate contract: the gates ask
 * "does every releasing job reach a verification", while this asks "which
 * release carries the artifact, and is exactly one of them cut per push".
 *
 * The shell used to reach a user ONLY through an app release, so a push that
 * touched `packages/android` alone produced a bump commit and nothing else. The
 * app's release is now scoped away from that directory (`release/app-scope.js`)
 * and the shell has its own tag and release — which is what these assertions
 * hold together.
 */
import { expect, test, describe } from 'bun:test';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '..');
const WORKFLOWS = join(ROOT, '.github/workflows');
const ANDROID_BODY = 'publish-android.yml';

/** Read one workflow as parsed YAML. */
async function load(file: string): Promise<Record<string, any>> {
  const text = await Bun.file(join(WORKFLOWS, file)).text();
  return Bun.YAML.parse(text) as Record<string, any>;
}

describe('the Android release channels', () => {
  test("the APK is attached to whichever release carries this run's shell version", async () => {
    // The Android shell is a private application: there is no registry for it,
    // and the only artifact is the `.apk` on a GitHub release. There are TWO
    // channels that can carry it, and exactly one of them runs per push:
    //
    //   - the app released -> its release (`shell-release` stood down)
    //   - the app did not  -> the shell's own release, cut by `shell-release`
    //
    // The `if` therefore accepts either and carries `!cancelled()`: a SKIPPED
    // job in `needs` makes the dependent job skip by default, and exactly one of
    // these two is always skipped. Four facts keep the shape true, and each
    // fails silently on its own:
    //
    //   1. the job WAITS for both producers, because `gh release upload` needs
    //      the release to exist — running first would 404;
    //   2. it uploads the TAG a producer reported, never a branch;
    //   3. one build per run, never two;
    //   4. it asks for no npm publish, so nothing about it can drift into one.
    const doc = await load('release.yml');
    const apk = doc.jobs.apk;

    expect(apk?.uses, 'release.yml:apk must call the APK body').toBe(`./.github/workflows/${ANDROID_BODY}`);
    expect(apk.needs, 'release.yml:apk must wait for the app release').toContain('app');
    expect(apk.needs, 'release.yml:apk must wait for the shell release').toContain('shell-release');
    expect(apk.with?.tag).toBe('${{ needs.app.outputs.tag || needs.shell-release.outputs.tag }}');

    const condition = String(apk.if ?? '');
    expect(condition, 'the APK must run when either release produced a tag').toContain('!cancelled()');
    expect(condition, 'the APK must stand down when neither channel released').toContain(
      "needs.shell-release.outputs.tag != ''",
    );
    // `!cancelled()` alone also lets the job run after a FAILED shell release,
    // with an empty tag — `gh release view ""` would then fail on the wrong
    // thing and hide the real one.
    expect(condition, 'a failed shell release must not start the APK job').toContain(
      "needs.shell-release.result == 'success'",
    );

    // Android refuses an install whose versionCode does not increase, so a
    // fixed value would make every release after the first uninstallable over
    // the previous one. The run number is monotonic and needs no state.
    expect(apk.with?.['version-code'], 'the APK versionCode must move every release').toBe(
      '${{ github.run_number }}',
    );

    // No registry credential, no `npm` environment: a publish body that grew
    // either would be publishing an application package nobody asked for.
    const body = await load(ANDROID_BODY);
    expect(body.jobs.apk.environment, 'the APK body must not join the npm environment').toBeUndefined();
    const steps = body.jobs.apk.steps as Array<{ run?: string; uses?: string; env?: Record<string, string> }>;
    const text = JSON.stringify(steps);
    expect(text, 'the APK body must not publish to npm').not.toContain('npm publish');
    expect(text, 'the APK body must not read NPM_TOKEN').not.toContain('NPM_TOKEN');

    // And it DOES attach: a build with no upload step would produce an artifact
    // nobody can download, which is the failure this test exists for.
    expect(text, 'the APK body must upload to the GitHub release').toContain('gh release upload');
  });

  test("the shell release is driven by the tag's state, never by a job output", async () => {
    // The bump commit lands on `main` even when a run dies before tagging, and
    // the watermark has moved — so a later run will not bump again. A release
    // gated on `android.outputs.any` would therefore raise a version whose APK
    // never ships. The runner reads the release itself and reports the tag.
    const doc = await load('release.yml');
    const job = doc.jobs['shell-release'];

    expect(job, 'release.yml has no shell-release job').toBeDefined();
    expect(String(job.if ?? ''), 'the shell release must stand down when the app released').toContain(
      "needs.app.outputs.released != 'true'",
    );
    expect(String(job.if ?? ''), 'a failed app job must not cut a shell release').toContain(
      "needs.app.result == 'success'",
    );
    expect(job.if, 'the shell release must not be gated on the bump output').not.toContain('android.outputs');

    const steps = (job.steps as Array<{ run?: string }>) ?? [];
    const text = JSON.stringify(steps);
    expect(text, 'the shell release must run its own script').toContain('node release/android-release.mjs');
    // The tag is created by the script, which is the only place the prefix is
    // stated — a second copy in the YAML publishes under a tag nobody looks at.
    expect(text, 'the tag must not be created inline').not.toContain('gh release create');

    expect(job.outputs?.tag, 'the APK job reads the tag this job reports').toBeDefined();
  });

  test('the APK is built from the tag, so it matches the release it belongs to', async () => {
    // The tag, never the branch: `release.yml` gates the pushed commit, but the
    // release commit is a LATER one written by semantic-release — and the APK is
    // attached to that release. Checking out `main` would build a different tree
    // than the one the release names.
    const body = await load(ANDROID_BODY);
    const checkout = (body.jobs.apk.steps as Array<{ uses?: string; with?: Record<string, string> }>).find((step) =>
      step.uses?.startsWith('actions/checkout'),
    );
    expect(checkout?.with?.ref, 'the APK checkout must name the release tag').toBe('${{ inputs.tag }}');
  });
});
