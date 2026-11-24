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
import {
  resolveSessionImagePath,
  sessionArtifactRoots,
  sessionImageMime,
} from '@/server/routes/sessions/local-image';

const CWD = '/work/project';
const BRAIN = '/home/me/.gemini/antigravity-cli/brain/session-1';

describe('resolveSessionImagePath', () => {
  test('an absolute path inside the cwd resolves', () => {
    expect(resolveSessionImagePath('/work/project/shots/a.png', CWD, [])).toBe('/work/project/shots/a.png');
  });

  test('a relative path resolves against the cwd', () => {
    expect(resolveSessionImagePath('shots/a.png', CWD, [])).toBe('/work/project/shots/a.png');
  });

  test('file:// references are accepted as paths', () => {
    expect(resolveSessionImagePath('file:///work/project/a.png', CWD, [])).toBe('/work/project/a.png');
  });

  test('a path outside every root is refused', () => {
    expect(resolveSessionImagePath('/work/other/a.png', CWD, [])).toBeNull();
    expect(resolveSessionImagePath('../../etc/a.png', CWD, [])).toBeNull();
  });

  test("the harness's own artifact directory for this session is allowed", () => {
    expect(resolveSessionImagePath(`${BRAIN}/shot.jpg`, CWD, [BRAIN])).toBe(`${BRAIN}/shot.jpg`);
    expect(resolveSessionImagePath(`${BRAIN}/../other/shot.jpg`, CWD, [BRAIN])).toBeNull();
  });

  test('no cwd and no artifact root answers nothing', () => {
    expect(resolveSessionImagePath('/work/project/a.png', null, [])).toBeNull();
  });
});

describe('sessionArtifactRoots', () => {
  test('antigravity names the brain directory of THIS session', () => {
    const roots = sessionArtifactRoots('antigravity', 'session-1');
    expect(roots.some((root) => root.endsWith('/brain/session-1'))).toBe(true);
    expect(roots.every((root) => root.endsWith('/brain/session-1'))).toBe(true);
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
