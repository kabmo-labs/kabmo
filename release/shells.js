/**
 * Every shell this repository releases, in ONE table.
 *
 * A shell's bump used to be its own job, its own script and its own commit in
 * `.github/workflows/release.yml` — five sequential jobs that each checked the
 * repository out, installed its dependencies, bumped one `version.properties`,
 * committed and pushed. Nothing in that shape is load-bearing:
 *
 * - Every bump is independent (each reads its own watermark, its own version
 *   file and its own commit range), so running them in one working tree cannot
 *   change any individual decision.
 * - Every build (`apk-build`, `ipa-build`, `win-build`, `macos-build`,
 *   `linux-build`) reads `main` AFTER the bumps land, so what they need is "all
 *   versions are on the branch", not some particular order among them. The
 *   chain existed to keep the graph linear, and a single job is simpler than a
 *   chain of five.
 * - The per-shell `bumped`/`any` outputs are not consumed by anything the next
 *   job reads; only the combined answer reaches the commit step.
 *
 * What changes is the VISIBLE history: one `chore(release): bump the shells
 * (…)` per release instead of five, and one failure mode. A bump that used to
 * land alone kept going when a later shell's bump failed; the single runner
 * now computes every bump BEFORE anything is written, so a bumped shell can
 * never reach `app` while its sibling refused to.
 *
 * Each shell keeps its OWN descriptor module (`android.js`, `ios.js`, …) for
 * the file, the key, the line reader and the line rewriter, because those are
 * the facts a per-shell test asserts against the tree. This catalog is only the
 * list: which artefacts the loop covers, and in which order.
 */

import {
  ANDROID_SHELL,
  commitsSinceWatermark as androidCommits,
  readVersionName as androidRead,
  replaceVersionLine as androidReplace,
} from './android.js';
import {
  IOS_SHELL,
  commitsSinceWatermark as iosCommits,
  readVersionName as iosRead,
  replaceVersionLine as iosReplace,
} from './ios.js';
import {
  WINDOWS_SHELL,
  commitsSinceWatermark as windowsCommits,
  readVersionName as windowsRead,
  replaceVersionLine as windowsReplace,
} from './windows.js';
import {
  MACOS_SHELL,
  commitsSinceWatermark as macosCommits,
  readVersionName as macosRead,
  replaceVersionLine as macosReplace,
} from './macos.js';
import {
  LINUX_SHELL,
  commitsSinceWatermark as linuxCommits,
  readVersionName as linuxRead,
  replaceVersionLine as linuxReplace,
} from './linux.js';

/**
 * The shells, in the order the loop bumps them.
 *
 * The order is the historical android → ios → windows → macos → linux and is
 * not load-bearing — the bumps are independent — but it is kept deterministic
 * so the commit's subject line reads the same for the same set of changes, and
 * a regression that shuffles it is visible in the history rather than silent.
 */
export const SHELLS = [
  {
    id: 'android',
    ...ANDROID_SHELL,
    commitsSinceWatermark: androidCommits,
    readVersionName: androidRead,
    replaceVersionLine: androidReplace,
  },
  {
    id: 'ios',
    ...IOS_SHELL,
    commitsSinceWatermark: iosCommits,
    readVersionName: iosRead,
    replaceVersionLine: iosReplace,
  },
  {
    id: 'windows',
    ...WINDOWS_SHELL,
    commitsSinceWatermark: windowsCommits,
    readVersionName: windowsRead,
    replaceVersionLine: windowsReplace,
  },
  {
    id: 'macos',
    ...MACOS_SHELL,
    commitsSinceWatermark: macosCommits,
    readVersionName: macosRead,
    replaceVersionLine: macosReplace,
  },
  {
    id: 'linux',
    ...LINUX_SHELL,
    commitsSinceWatermark: linuxCommits,
    readVersionName: linuxRead,
    replaceVersionLine: linuxReplace,
  },
];

/**
 * The one shell a `--only` run names, or null when it names none.
 *
 * @param {string} id A shell id from the table above.
 * @returns {object|null}
 */
export function shellById(id) {
  return SHELLS.find((shell) => shell.id === id) ?? null;
}
