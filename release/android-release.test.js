/**
 * The Android shell's own release channel, asserted.
 *
 * Two things are being pinned here, and both fail SILENTLY when wrong:
 *
 * 1. **The tag prefix collides with no other channel.** The app's `tagFormat` is
 *    `^v(.+)` and `publish-plugins.yml` triggers on `kabmo-sdk/v*` and
 *    `kabmo-ui/v*`. A prefix that matched either would start a second pipeline
 *    from a shell release — or, worse, be read as an app version.
 * 2. **A release is published once.** The plan is what makes a re-run
 *    idempotent, and it reads the release LIST rather than a job output, because
 *    the bump commit lands on `main` even when a run dies before tagging.
 */
import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHELL_TAG_PREFIX, hasApk, planShellRelease, shellTag } from './android-release.js';
import { repoRoot } from './packages.mjs';

describe('the shell tag is its own namespace', () => {
  test('it matches neither the app tagFormat nor the package trigger prefixes', () => {
    const appTagFormat = /^v(.+)$/;
    const packageTriggers = [/^kabmo-sdk\/v/, /^kabmo-ui\/v/];
    const tag = shellTag('0.4.0');

    expect(appTagFormat.test(tag), `${tag} must not look like an app version`).toBe(false);
    for (const trigger of packageTriggers) {
      expect(trigger.test(tag), `${tag} must not trigger a package publish`).toBe(false);
    }

    // And it does parse back to the version, so `fetchAndroidRelease` can read a
    // release it finds by scanning the list.
    expect(tag.startsWith(SHELL_TAG_PREFIX)).toBe(true);
    expect(tag.slice(SHELL_TAG_PREFIX.length)).toBe('0.4.0');
  });

  test('the workflow creates the release through the runner, never inline', () => {
    // The tag prefix, the plan and the notes all live in release/, where they
    // are tested. An inline `gh release create` in the YAML would be a second
    // copy of the prefix — and a typo there publishes an APK under a tag the
    // console never looks at.
    //
    // Comment lines are excluded: the workflow's own explanation names the
    // prefix, and only an EXECUTED copy can publish anything.
    const workflow = readFileSync(join(repoRoot, '.github/workflows/release.yml'), 'utf8');
    const executed = workflow
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');

    expect(executed, 'the shell release must run its own script').toContain('node release/android-release.mjs');
    expect(executed, 'the tag prefix must not be restated in a step').not.toContain('kabmo-android/v');
    expect(executed, 'the shell release must not create its release inline').not.toContain('gh release create');
  });
});

describe('planShellRelease', () => {
  const VERSION = '0.4.0';

  test('creates the release when no release carries this tag', () => {
    expect(planShellRelease(VERSION, null)).toMatchObject({ action: 'create', tag: 'kabmo-android/v0.4.0' });
  });

  test('attaches when the release exists but lost its APK', () => {
    // A build that failed after the tag: the release is real, and re-creating it
    // would fail the job. The APK job uploads against the tag instead.
    expect(planShellRelease(VERSION, { assets: [{ name: 'notes.txt' }] })).toMatchObject({ action: 'attach' });
    expect(planShellRelease(VERSION, {})).toMatchObject({ action: 'attach' });
  });

  test('skips a release that is already published', () => {
    expect(planShellRelease(VERSION, { assets: [{ name: 'kabmo-android-v0.4.0.apk' }] })).toMatchObject({
      action: 'skip',
      tag: 'kabmo-android/v0.4.0',
    });
  });

  test('the lookup is by THIS version\'s tag, never "some release carries an APK"', () => {
    // The tag handed to `gh release view` comes from the version the file
    // declares, so a release of a different version can never satisfy this one:
    // a shell that is behind must still be offered the release matching the
    // number it now declares.
    expect(shellTag('0.5.0')).not.toBe(shellTag('0.4.0'));
    expect(planShellRelease('0.5.0', null)).toMatchObject({ action: 'create', tag: 'kabmo-android/v0.5.0' });
  });
});

describe('hasApk', () => {
  test('reads the asset list, not a name it builds itself', () => {
    expect(hasApk([{ name: 'kabmo-android-v1.0.0.apk' }])).toBe(true);
    expect(hasApk([{ name: 'kabmo-android-v1.0.0.apk.zip' }])).toBe(false);
    expect(hasApk([{ name: 'notes.txt' }])).toBe(false);
    expect(hasApk([])).toBe(false);
    // A release body that is not a list is not an APK.
    expect(hasApk(undefined)).toBe(false);
    expect(hasApk({ name: 'x.apk' })).toBe(false);
  });
});

describe('the shell release notes', () => {
  test('render the shell commits with the app\'s own section shape', async () => {
    // The notes are generated through the config's own `notesOptions`, so a
    // shell release reads like an app release — Added / Changed / Fixed, with
    // the scope in bold and a commit link. Rendered here rather than asserted on
    // the options object, because the options alone prove nothing about output.
    const { generateNotes } = await import('@semantic-release/release-notes-generator');
    const { notesOptions } = await import('../release.config.mjs');
    const { toCommit } = await import('./bump.js');

    const notes = await generateNotes(notesOptions, {
      commits: [
        toCommit({ hash: 'a'.repeat(40), message: 'feat(android): add the APK installer' }),
        toCommit({ hash: 'b'.repeat(40), message: 'fix(android): keep the session across a restart' }),
      ],
      lastRelease: {},
      nextRelease: { version: '0.5.0', gitTag: shellTag('0.5.0'), gitHead: 'HEAD' },
      options: { repositoryUrl: 'https://github.com/kabmo-labs/kabmo.git' },
      cwd: repoRoot,
      logger: { log() {} },
    });

    expect(notes).toContain('### Added');
    expect(notes).toContain('### Fixed');
    expect(notes).toContain('**android:** add the APK installer');
    expect(notes).toContain('/commit/aaaaaaaa');
  });
});
