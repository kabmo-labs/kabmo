/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The session image route's path rules, without a database or a live server.
 *
 * The route exists because a chat answer names pictures as local paths; the
 * test pins the boundary that makes it safe — the session's cwd and its own
 * harness artifact directory, nothing else.
 */

import { describe, expect, test } from 'bun:test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  resolveSessionImagePath,
  sessionArtifactRoots,
  sessionImageMime,
} from '@/server/routes/sessions/local-image';

/**
 * The two roots are built by the platform, not written as POSIX literals.
 *
 * `/work/project` is a rooted path on every platform — on Windows it resolves
 * against the current DRIVE — so a literal expectation pinned the separator and
 * failed the whole file on the Windows leg while the rule under test
 * (containment) held. Every expectation below is therefore the same value the
 * route is asked about, spelled by `path` itself.
 */
const CWD = path.resolve('/work/project');
const BRAIN = path.resolve('/home/me/.gemini/antigravity-cli/brain/session-1');

describe('resolveSessionImagePath', () => {
  test('an absolute path inside the cwd resolves', () => {
    const shot = path.join(CWD, 'shots', 'a.png');
    expect(resolveSessionImagePath(shot, CWD, [])).toBe(shot);
  });

  test('a relative path resolves against the cwd', () => {
    expect(resolveSessionImagePath('shots/a.png', CWD, [])).toBe(path.join(CWD, 'shots', 'a.png'));
  });

  test('file:// references are accepted as paths', () => {
    const shot = path.join(CWD, 'a.png');
    expect(resolveSessionImagePath(pathToFileURL(shot).href, CWD, [])).toBe(shot);
  });

  test('a path outside every root is refused', () => {
    expect(resolveSessionImagePath(path.join(path.resolve('/work/other'), 'a.png'), CWD, [])).toBeNull();
    expect(resolveSessionImagePath('../../etc/a.png', CWD, [])).toBeNull();
  });

  test("the harness's own artifact directory for this session is allowed", () => {
    const shot = path.join(BRAIN, 'shot.jpg');
    expect(resolveSessionImagePath(shot, CWD, [BRAIN])).toBe(shot);
    expect(resolveSessionImagePath(path.join(BRAIN, '..', 'other', 'shot.jpg'), CWD, [BRAIN])).toBeNull();
  });

  test('no cwd and no artifact root answers nothing', () => {
    expect(resolveSessionImagePath(path.join(CWD, 'a.png'), null, [])).toBeNull();
  });
});

describe('sessionArtifactRoots', () => {
  test('antigravity names the brain directory of THIS session', () => {
    const roots = sessionArtifactRoots('antigravity', 'session-1');
    expect(roots.length).toBeGreaterThan(0);
    // Every root, not just one: a root for a DIFFERENT session is the bug this
    // pins, and `some` alone would pass while the other one leaked.
    for (const root of roots) {
      expect(path.basename(root)).toBe('session-1');
      expect(path.basename(path.dirname(root))).toBe('brain');
    }
  });

  test('another harness has no artifact root of its own', () => {
    expect(sessionArtifactRoots('omp-rpc', 'session-1')).toEqual([]);
    expect(sessionArtifactRoots(null, 'session-1')).toEqual([]);
  });
});

describe('sessionImageMime', () => {
  test('the raster formats are served', () => {
    expect(sessionImageMime('/work/a.jpg')).toBe('image/jpeg');
    expect(sessionImageMime('/work/a.png')).toBe('image/png');
  });

  test('an SVG is a document, not a preview', () => {
    expect(sessionImageMime('/work/a.svg')).toBeNull();
    expect(sessionImageMime('/work/a.txt')).toBeNull();
  });
});
