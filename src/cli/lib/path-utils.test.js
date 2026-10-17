/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The CLI's own path helpers, on both platforms' path spellings.
 *
 * These are not cosmetic: `ompchamber.js` derives the package root from
 * `import.meta.dir`, and every entry the CLI runs — the built server, the dev
 * entry, the build script, the login-entry argv — hangs off that root. A
 * resolver that recognizes only a leading `/` treats a Windows path as
 * relative, prefixes the cwd twice and answers a path that exists nowhere:
 * measured against the published tarball, `ompchamber serve` reported "This
 * install is incomplete" for an install that ships `dist/client`.
 *
 * The Windows cases therefore assert on the SHAPE of the answer (an absolute
 * path, the cwd not re-prefixed, a drive letter appearing once) rather than on
 * `fs.existsSync` — the suite runs on macOS, so the cwd is stubbed for them.
 */

import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';

import { homeDir, isAbsolutePath, joinPath, resolvePath } from '@/cli/lib/path-utils.js';
import { isWindows } from '@/test-support/platform';

/**
 * Run `fn` with `process.cwd()` answering `value`.
 *
 * The only way to pin a Windows resolution without a Windows host: the helpers
 * read the cwd through that one call, and every branch under test is decided by
 * the SEGMENTS, so a stubbed cwd exercises the real code path.
 */
function withCwd(value, fn) {
  const original = process.cwd;
  Object.defineProperty(process, 'cwd', { value: () => value, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'cwd', { value: original, configurable: true });
  }
}

describe('homeDir', () => {
  // The CLI must resolve the same data directory as the server (which uses
  // os.homedir()). Reading Bun.env.HOME yields '' without a shell (cron,
  // launchd, GUI launcher), which silently made every derived path relative to
  // the cwd — `stop`/`status` then missed the running instance.
  test('is absolute even when HOME is absent from the environment', () => {
    const saved = Bun.env.HOME;
    try {
      delete Bun.env.HOME;
      expect(homeDir()).toBe(homedir());
      // The invariant is ABSOLUTENESS, not a leading `/`: a Windows home is
      // `C:\Users\x`, which is absolute and not `/`-rooted. Asserting the
      // portable predicate keeps the case meaningful on both platforms.
      expect(isAbsolutePath(homeDir())).toBe(true);
    } finally {
      if (saved !== undefined) Bun.env.HOME = saved;
    }
  });

  test('agrees with os.homedir()', () => {
    expect(homeDir()).toBe(homedir());
  });
});

describe('isAbsolutePath', () => {
  test('recognizes both platforms’ spellings', () => {
    expect(isAbsolutePath('/tmp/x')).toBe(true);
    expect(isAbsolutePath('C:\\Users\\x')).toBe(true);
    expect(isAbsolutePath('C:/Users/x')).toBe(true);
    expect(isAbsolutePath('\\\\server\\share')).toBe(true);
    expect(isAbsolutePath('//server/share')).toBe(true);
  });

  test('rejects relative spellings, including a bare drive', () => {
    expect(isAbsolutePath('rel/dir')).toBe(false);
    expect(isAbsolutePath('..')).toBe(false);
    expect(isAbsolutePath('')).toBe(false);
    expect(isAbsolutePath(undefined)).toBe(false);
    // `C:` with no separator is drive-RELATIVE on Windows, not absolute.
    expect(isAbsolutePath('C:')).toBe(false);
  });
});

describe('joinPath', () => {
  test('keeps a single separator between segments', () => {
    expect(joinPath('/a', 'b', 'c')).toBe('/a/b/c');
    expect(joinPath('/a/', '/b')).toBe('/a/b');
    expect(joinPath('/a//', '//b')).toBe('/a/b');
  });

  test('skips empty segments', () => {
    expect(joinPath('/a', '', 'b')).toBe('/a/b');
  });

  test('normalizes Windows separators so a joined path is comparable', () => {
    expect(joinPath('C:\\a', 'b', 'c')).toBe('C:/a/b/c');
    expect(joinPath('C:\\Users\\x\\ompchamber', 'dist', 'client', 'index.js'))
      .toBe('C:/Users/x/ompchamber/dist/client/index.js');
  });
});

describe('resolvePath', () => {
  test('returns an absolute path for an absolute input', () => {
    expect(resolvePath('/tmp/x')).toBe('/tmp/x');
    expect(resolvePath('/tmp/x/')).toBe('/tmp/x');
  });

  test('resolves relative input against the cwd', () => {
    expect(resolvePath('rel/dir')).toBe(joinPath(process.cwd(), 'rel/dir'));
  });

  test('a `.` segment contributes nothing', () => {
    // `resolvePath` normalises separators to `/` (that is what makes a joined
    // path comparable across platforms), so the expectation normalises the cwd
    // the same way — on Windows `process.cwd()` is `D:\\a\\b` and the answer is
    // `D:/a/b`, which is the same path, not a different one.
    expect(resolvePath(process.cwd(), '.')).toBe(process.cwd().replace(/\\/g, '/'));
  });

  test('an absolute segment discards everything before it', () => {
    expect(resolvePath('/cwd/here', '/tmp/x')).toBe('/tmp/x');
    expect(resolvePath('/cwd/here', 'rel')).toBe('/cwd/here/rel');
  });

  test('the data dir derived from homeDir is always absolute', () => {
    const saved = Bun.env.HOME;
    try {
      delete Bun.env.HOME;
      if (!isWindows) expect(joinPath(homeDir(), '.ompchamber').startsWith('/')).toBe(true);
      // The claim in the name is absoluteness, and that holds on both
      // platforms — `C:/Users/x/.ompchamber` is as absolute as `/Users/x/…`.
      expect(isAbsolutePath(joinPath(homeDir(), '.ompchamber'))).toBe(true);
    } finally {
      if (saved !== undefined) Bun.env.HOME = saved;
    }
  });

  // The issue #5 regression. `ompchamber.js` calls exactly this shape with
  // `import.meta.dir`, which on Windows is a drive-rooted backslash path.
  describe('on Windows', () => {
    const WIN_DIR = 'C:\\Users\\Administrator\\.bun\\install\\global\\node_modules\\ompchamber\\src\\cli';

    test('the package root keeps one drive letter and is not cwd-prefixed', () => {
      const pkgRoot = withCwd('C:\\', () => resolvePath(WIN_DIR, '..', '..'));
      // The bug answered `C:\/C:\/C:\Users\...\src\cli/../..`.
      expect(pkgRoot.startsWith('C:/')).toBe(true);
      expect(pkgRoot.indexOf('C:', 1)).toBe(-1);
      expect(pkgRoot).not.toContain('C:\\');
      expect(pkgRoot).toBe('C:/Users/Administrator/.bun/install/global/node_modules/ompchamber/src/cli/../..');
    });

    test('every path derived from the package root stays inside it', () => {
      const pkgRoot = withCwd('C:\\', () => resolvePath(WIN_DIR, '..', '..'));
      expect(joinPath(pkgRoot, 'dist', 'client', 'index.js'))
        .toBe('C:/Users/Administrator/.bun/install/global/node_modules/ompchamber/src/cli/../../dist/client/index.js');
      expect(joinPath(pkgRoot, 'scripts', 'build-client.ts')).toContain('/ompchamber/src/cli/../../scripts/');
    });

    test('a drive-rooted segment is absolute, so it discards the cwd', () => {
      expect(withCwd('C:\\proj', () => resolvePath('C:\\other'))).toBe('C:/other');
      expect(withCwd('C:\\proj', () => resolvePath('C:\\proj', 'sub'))).toBe('C:/proj/sub');
    });

    test('a relative segment still resolves against a Windows cwd', () => {
      expect(withCwd('C:\\proj', () => resolvePath('sub'))).toBe('C:/proj/sub');
      expect(withCwd('C:\\proj', () => resolvePath('.'))).toBe('C:/proj');
    });

    test('a UNC path keeps its double-slash prefix', () => {
      expect(withCwd('C:\\', () => resolvePath('\\\\server\\share', 'dir'))).toBe('//server/share/dir');
      expect(withCwd('C:\\', () => resolvePath('//server/share/'))).toBe('//server/share');
    });

    test('an absolute POSIX path is still absolute there', () => {
      // A git-bash style argument on Windows: absolute, so it must not be
      // relocated under the cwd.
      expect(withCwd('C:\\proj', () => resolvePath('/tmp/x'))).toBe('/tmp/x');
    });
  });
});
