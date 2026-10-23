/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The window-drag contract, at the two places it can silently break.
 *
 * The macOS shell does not read CSS to decide a drag: a WKWebView swallows mouse
 * events, so `ShellWindow.mouseDown` asks the page whether the press landed on
 * `[data-drag-region]`, walking up and stopping at any interactive element. That
 * makes two things load-bearing, and neither fails loudly:
 *
 * 1. **the header must carry the attribute** — without it the window cannot be
 *    moved by its own title bar, which is what the previous shell shipped;
 * 2. **the PWA's `-webkit-app-region` must survive the bundle** — it is what the
 *    browser-installed app reads for its Window Controls Overlay, and Tailwind's
 *    minifier is the last step that could drop it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import cssPlugin from '@/server/lib/bundler/css';

async function build(css: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'kabmo-titlebar-'));
  try {
    await Bun.write(join(dir, 'probe.css'), css);
    const result = await Bun.build({
      entrypoints: [join(dir, 'probe.css')],
      outdir: join(dir, 'out'),
      target: 'bun',
      minify: true,
      plugins: [cssPlugin],
    });
    if (!result.success) throw new Error(result.logs.map((log) => log.message).join('\n'));
    return await Bun.file(join(dir, 'out', 'probe.css')).text();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('window-drag contract', () => {
  /**
   * The shell's hit test starts at the element under the pointer and walks up.
   * A header without the attribute is a header that cannot move the window.
   *
   * EVERY header that can be the window's top strip is listed, not just the
   * desktop pair. A desktop shell window may be narrower than `App`'s 768px
   * layout breakpoint (all three shells allow 720px), so the phone layout's
   * headers are title bars too — and the mobile ones were missing the attribute
   * entirely, which on macOS left a narrowed window with no draggable strip in
   * its main screen and no way to move it.
   */
  test('every title-bar header carries data-drag-region', () => {
    for (const path of [
      'src/client/components/layout/desktop-layout/TopNavbar.tsx',
      'src/client/components/layout/session-sidebar/Header.tsx',
      'src/client/components/mobile/mobile-main-view/Header.tsx',
      'src/client/components/mobile/mobile-session-sidebar/Header.tsx',
      'src/client/components/mobile/RightSidebar.tsx',
    ]) {
      const file = source(path);
      expect(file).toContain('dragRegionProps()');
    }
    // The attribute name is stated once, in the module the headers import.
    expect(source('src/client/lib/desktop/titlebar.ts')).toContain("'data-drag-region'");
  });

  /**
   * The phone headers reserve the shell's own inset, not only the PWA's.
   *
   * `titlebarPaddingLeft` reads `env(titlebar-area-x)`, which a native WKWebView
   * never defines — so the shell's 76px of traffic lights has to come from
   * `titlebarInsetLeft`, the helper the desktop headers already use. Without it
   * the phone header's hamburger and wordmark sat UNDER the traffic lights.
   */
  test('the phone headers use the shell inset', () => {
    for (const path of [
      'src/client/components/mobile/mobile-main-view/Header.tsx',
      'src/client/components/mobile/mobile-session-sidebar/Header.tsx',
      'src/client/components/mobile/RightSidebar.tsx',
    ]) {
      expect(source(path)).toContain('titlebarInsetLeft(');
    }
  });

  /**
   * A header marked as a drag region makes its controls drag handles unless
   * they say otherwise — `app-region` INHERITS (WebView2's spec, enforced by
   * Chromium 152), and a drag handle swallows the click.
   */
  test('a drag-region header marks its controls no-drag', () => {
    const pairs: Array<[string, string]> = [
      ['src/client/components/mobile/RightSidebar.tsx', 'titlebar-no-drag'],
      ['src/client/components/common/header-controls/index.tsx', 'titlebar-no-drag'],
    ];
    for (const [path, marker] of pairs) expect(source(path)).toContain(marker);
  });

  /** The PWA keeps its drag region: the property has to reach the browser. */
  test('the webkit property survives the bundle', async () => {
    const out = await build(`
.titlebar-drag-region { -webkit-app-region: drag; app-region: drag; }
.titlebar-no-drag { -webkit-app-region: no-drag; app-region: no-drag; }
`);
    expect(out).toContain('-webkit-app-region:drag');
    expect(out).toContain('-webkit-app-region:no-drag');
  });
});
