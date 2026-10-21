/**
 * The Android shell's own release channel, in one place.
 *
 * The shell is the one artifact in this repository that is NOT delivered by the
 * app's version: `packages/android` has a version of its own
 * (`version.properties`), a bump of its own (`release/release-android.mjs`) and
 * — since the app's release was scoped away from that directory
 * (`release/app-scope.js`) — a GitHub release of its own, cut by
 * `release/android-release.mjs` and built by `.github/workflows/publish-android.yml`.
 *
 * Two facts are stated here because both are asserted by tests and both fail
 * silently when wrong:
 *
 * - **The tag prefix matches no other channel.** The app's `tagFormat` is
 *   `^v(.+)` and `publish-plugins.yml` triggers on `kabmo-sdk/v*` and
 *   `kabmo-ui/v*`; `kabmo-android/v*` matches neither, so cutting this tag
 *   starts no second pipeline and is never mistaken for a version of the app.
 * - **A release is published once.** The plan below is what makes a re-run
 *   idempotent, and the state it reads is the TAG — never a job output. The bump
 *   commit lands on `main` even when a run dies before tagging, and the
 *   watermark has moved, so a later run will not bump again: a release driven by
 *   "did the bump happen" would raise a version whose APK never ships.
 */

/** The tag prefix a shell release is published under. */
export const SHELL_TAG_PREFIX = 'kabmo-android/v';

/** The tag one shell version is published under. */
export function shellTag(version) {
  return `${SHELL_TAG_PREFIX}${version}`;
}

/** Whether a release's asset list carries an APK. */
export function hasApk(assets) {
  return Array.isArray(assets) && assets.some((asset) => String(asset?.name ?? '').endsWith('.apk'));
}

/**
 * What to do about the shell version currently declared, given the release that
 * already exists for it.
 *
 * Pure, because every branch is a state a real run has been in and the decision
 * is the only part worth asserting:
 *
 *   create  no release for this version — cut it, and the `apk` job uploads
 *   attach  the release exists but lost its APK (a build that failed after the
 *           tag) — create nothing, let the `apk` job attach one
 *   skip    the release is published; nothing to do
 *
 * `existing` is the release looked up BY THIS VERSION'S TAG, never "the newest
 * release that happens to carry an APK": a shell that is behind must be offered
 * the release matching the number it now declares, and a release of a different
 * version says nothing about this one.
 *
 * @param {string} version The shell version currently declared.
 * @param {{assets?: unknown}|null} existing The release for that tag, or null.
 * @returns {{action: 'create'|'attach'|'skip', tag: string, reason: string}}
 */
export function planShellRelease(version, existing) {
  const tag = shellTag(version);

  if (!existing) {
    return { action: 'create', tag, reason: `no release for ${tag}` };
  }

  if (hasApk(existing.assets)) {
    return { action: 'skip', tag, reason: `${tag} already carries an APK` };
  }

  return { action: 'attach', tag, reason: `${tag} exists but carries no APK` };
}
