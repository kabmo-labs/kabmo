/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The DESKTOP half of the shell-release read: which artifact a per-architecture
 * shell installs, and when the answer is only the release page.
 *
 * Split from `shell-release.test.ts` because that file is at the repo's 350-line
 * ceiling, and the two questions are separable: the mobile pair resolves ONE
 * artifact for every device, while the desktop trio's answer depends on the
 * architecture the shell reported.
 */

import { beforeEach, describe, expect, test } from 'bun:test';

import { fetchShellRelease, resetShellReleaseCache } from '@/server/lib/updates/shell-release';

/** A fetch double that answers one body. */
function stubFetch(body: unknown) {
  const calls: string[] = [];
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return {
      ok: true,
      json: async () => body,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('fetchShellRelease — desktop architectures', () => {
  // The cache is process-wide (see `resetShellReleaseCache`), so every case
  // starts from a cold one or it reads the previous case's answer.
  beforeEach(() => resetShellReleaseCache());

  /**
   * A desktop probe WITHOUT an architecture answers the RELEASE PAGE.
   *
   * Every desktop artifact is per-architecture, and a console served to another
   * machine cannot know which one the window asking runs on. Naming one arch's
   * file would hand half the readers a build that will not launch, so the link is
   * the page that lists all of them and `direct` says it is not installable.
   */
  test('a desktop probe without an arch answers the release page', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac-arm.zip' },
          { name: 'Kabmo-0.2.0-mac-x64.dmg', browser_download_url: 'https://x/mac-x64.dmg' },
        ],
      },
    ]);

    expect(await fetchShellRelease('macos', impl)).toEqual({
      url: 'https://x/app',
      latest: '0.2.0',
      releaseUrl: 'https://x/app',
      direct: false,
    });
  });

  /**
   * WITH an architecture it answers that machine's own installer.
   *
   * This is what makes the desktop self-update possible at all: the shell
   * reports its arch over the bridge, and the console names ONE file instead of
   * a page a human has to read.
   */
  test('a desktop probe with an arch answers that arch’s installer', async () => {
    const { impl } = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-mac-x64.zip', browser_download_url: 'https://x/mac-x64.zip' },
          { name: 'Kabmo-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac-arm.zip' },
        ],
      },
    ]);

    expect(await fetchShellRelease('macos', impl, 'arm64')).toEqual({
      url: 'https://x/mac-arm.zip',
      latest: '0.2.0',
      releaseUrl: 'https://x/app',
      direct: true,
    });
  });

  test('an arch the release does not publish keeps the page, never the sibling', async () => {
    // A build that only shipped x64 must not be installed on an arm64 machine:
    // the page is a correct answer, the other architecture's file is not.
    const { impl } = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-mac-x64.zip', browser_download_url: 'https://x/mac-x64.zip' },
        ],
      },
    ]);

    expect(await fetchShellRelease('macos', impl, 'arm64')).toEqual({
      url: 'https://x/app',
      latest: '0.2.0',
      releaseUrl: 'https://x/app',
      direct: false,
    });
  });

  test('the self-update file is the ONE file that shell can install', async () => {
    // macOS installs from the `.zip` (ditto extracts it); the `.dmg` beside it is
    // for a human. Windows installs from the Inno `.exe`; Linux from the
    // AppImage, which is the only one of its four formats a shell can replace.
    const mac = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-mac-arm64.dmg', browser_download_url: 'https://x/mac-arm.dmg' },
          { name: 'Kabmo-0.2.0-mac-arm64.zip', browser_download_url: 'https://x/mac-arm.zip' },
        ],
      },
    ]);
    expect((await fetchShellRelease('macos', mac.impl, 'arm64'))?.url).toBe('https://x/mac-arm.zip');

    const win = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-win-x64-setup.exe', browser_download_url: 'https://x/win-x64.exe' },
        ],
      },
    ]);
    expect((await fetchShellRelease('windows', win.impl, 'x64'))?.url).toBe('https://x/win-x64.exe');

    const linux = stubFetch([
      {
        html_url: 'https://x/app',
        assets: [
          { name: 'Kabmo-0.2.0-linux-x86_64.tar.gz', browser_download_url: 'https://x/linux.tgz' },
          { name: 'Kabmo-0.2.0-linux-x86_64.AppImage', browser_download_url: 'https://x/linux.AppImage' },
        ],
      },
    ]);
    expect((await fetchShellRelease('linux', linux.impl, 'x64'))?.url).toBe('https://x/linux.AppImage');
  });

  test('the arch is part of the cache key', async () => {
    // One console is routinely shared by a whole team, and two machines on it
    // differ only by architecture. A shared slot would answer the second one with
    // the first one's installer.
    const release = {
      html_url: 'https://x/app',
      assets: [
        { name: 'Kabmo-0.3.0-mac-arm64.zip', browser_download_url: 'https://x/arm.zip' },
        { name: 'Kabmo-0.3.0-mac-x64.zip', browser_download_url: 'https://x/x64.zip' },
      ],
    };
    expect((await fetchShellRelease('macos', stubFetch([release]).impl, 'arm64'))?.url).toBe('https://x/arm.zip');

    const { impl, calls } = stubFetch([release]);
    expect((await fetchShellRelease('macos', impl, 'x64'))?.url).toBe('https://x/x64.zip');
    expect(calls.length, 'a different arch is a different question').toBeGreaterThan(0);
  });
});
