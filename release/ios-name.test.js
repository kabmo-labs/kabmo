/**
 * The iOS shell's NAME, asserted.
 *
 * A name is not decoration: `CFBundleDisplayName` is what the Home Screen, the app
 * switcher and Settings print, and a shell whose icon reads one thing while its
 * Settings row reads another is two products on one device. Nothing fails when it
 * drifts — the app still launches, just under a name nobody chose — which is why it
 * is pinned here rather than left to review.
 *
 * Three files have to agree, and each can be changed on its own:
 *
 * - `Resources/Info.plist` declares the name and the executable's file name;
 * - `scripts/build-ipa.sh` copies the SwiftPM product to the name the plist expects,
 *   and refuses to assemble a bundle whose name is not `Kabmo`;
 * - `publish-ios.yml` re-checks the name on the ARTIFACT, so a build that skipped the
 *   script's check cannot ship.
 *
 * The SwiftPM product stays `kabmo-shell` — a lower-case binary name is the
 * platform's convention and SwiftPM derives it from the target — which is exactly the
 * gap that would otherwise go unnoticed.
 */
import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './packages.mjs';

const IOS = join(repoRoot, 'packages/ios');
const PLIST = join(IOS, 'Resources/Info.plist');
const SCRIPT = join(IOS, 'scripts/build-ipa.sh');
const WORKFLOW = join(repoRoot, '.github/workflows/publish-ios.yml');

/** One `<key>`'s `<string>` value, without a plist library. */
function plistString(source, key) {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`);
  const match = source.match(pattern);
  return match ? match[1] : null;
}

describe('the iOS shell is called Kabmo', () => {
  test('the bundle declares the name the Home Screen prints', () => {
    const plist = readFileSync(PLIST, 'utf8');

    expect(plistString(plist, 'CFBundleDisplayName')).toBe('Kabmo');
    // `CFBundleName` is the short name: 16 characters max, and the fallback for a
    // surface that has no display name. It is the same word.
    expect(plistString(plist, 'CFBundleName')).toBe('Kabmo');
    expect(plistString(plist, 'CFBundleName').length).toBeLessThanOrEqual(16);
  });

  test('the executable inside the bundle is named Kabmo, not the SwiftPM product', () => {
    // The product is `kabmo-shell` (SwiftPM derives it from the target). The bundle's
    // FILE is `Kabmo`, which is what `CFBundleExecutable` must name — and what the
    // build script copies it to.
    const plist = readFileSync(PLIST, 'utf8');
    expect(plistString(plist, 'CFBundleExecutable')).toBe('Kabmo');

    const script = readFileSync(SCRIPT, 'utf8');
    expect(script, 'the build must copy the product to the name the plist declares').toContain(
      'cp "$BIN" "$APP/Kabmo"',
    );
    expect(script, 'the build must not leave the bundle with the product name').not.toContain(
      'cp "$BIN" "$APP/kabmo-shell"',
    );
  });

  test('the bundle directory is Kabmo.app', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toContain('APP="$STAGE/Payload/Kabmo.app"');
  });

  test('the build refuses a bundle whose name is not Kabmo', () => {
    // Checked rather than assumed: a renamed plist ships a shell called something
    // else with nothing failing anywhere.
    const script = readFileSync(SCRIPT, 'utf8');
    expect(script).toContain('plutil -extract CFBundleDisplayName raw');
    expect(script).toContain('CFBundleDisplayName is \'$name\', not \'Kabmo\'');
    expect(script).toContain('plutil -extract CFBundleName raw');
  });

  test('the workflow re-checks the name on the ARTIFACT', () => {
    // The script guards a local run; this guards the bytes that ship. The two are not
    // redundant: a workflow that ran a stale checkout, or a future step that rewrote
    // the plist after assembly, would pass the first and fail here.
    const workflow = readFileSync(WORKFLOW, 'utf8');
    expect(workflow).toContain('plutil -extract CFBundleDisplayName raw "$app/Info.plist"');
    expect(workflow).toContain('test "$name" = "Kabmo"');
    expect(workflow).toContain('test "$short" = "Kabmo"');
    // The executable is read from the plist rather than hard-coded, so the two cannot
    // disagree — a hard-coded path here is how the rename would be missed.
    expect(workflow).toContain('test -x "$app/$executable"');
  });

  test('the console names the shell the same way in its own copy', () => {
    // The download label is what a reader sees beside the button, and it names the
    // platform, not the bundle: "Update Kabmo 0.2.0 for iOS". The product name in that
    // sentence has to be the same word the Home Screen prints.
    const source = readFileSync(join(repoRoot, 'src/client/hooks/ui/updates/shell-download.ts'), 'utf8');
    expect(source).toContain("ios: 'iOS'");
    expect(source).toContain('`${verb} Kabmo ${download.latest} for ${PLATFORM_NAMES[download.platform]}`');
  });

  test('the shortcut that reaches the settings screen names it, not the app', () => {
    // A quick action's title is a SCREEN name ("Server settings"), and the app's own
    // name is the icon above it — a shortcut repeating "Kabmo" would be the icon's
    // label twice.
    const plist = readFileSync(PLIST, 'utf8');
    const title = plist.match(/<key>UIApplicationShortcutItemTitle<\/key>\s*<string>([^<]*)<\/string>/);
    expect(title?.[1]).toBe('Server settings');
  });
});
