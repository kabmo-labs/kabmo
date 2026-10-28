/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone's editor state, built from an open-file payload.
 *
 * Two fields the mapper must carry are the reason this file exists: `repo` and
 * `handleId` were dropped on the mobile path, so a file in a nested repository
 * resolved its raw URL against the workspace root and a dropped file fetched
 * bytes from a path it does not have. The payload is `unknown` (an explorer
 * row, a plugin panel and a drop all hand over their own object), so the guards
 * are the contract — a payload naming no file must produce nothing rather than
 * a tab called `undefined`.
 */

import { describe, expect, test } from 'bun:test';
import { mobileEditorFileFrom } from '@/client/components/mobile/open-file-payload';

describe('mobileEditorFileFrom', () => {
  test('carries repo and handleId through', () => {
    const result = mobileEditorFileFrom({
      path: 'projects/token/README.md',
      name: 'README.md',
      root: '/ws',
      repo: 'projects/token',
      handleId: 'handle-7',
    });
    expect(result).toEqual({
      name: 'README.md',
      path: 'projects/token/README.md',
      content: undefined,
      root: '/ws',
      repo: 'projects/token',
      handleId: 'handle-7',
    });
  });

  test('leads the path with no slash, and derives a name when none is given', () => {
    const result = mobileEditorFileFrom({ path: '/a/b/pic.png' });
    expect(result?.path).toBe('a/b/pic.png');
    expect(result?.name).toBe('pic.png');
  });

  test('falls back to the active project only when the payload has no root', () => {
    expect(mobileEditorFileFrom({ path: 'x.md' }, '/active')?.root).toBe('/active');
    // A caller that knows its own scope keeps it.
    expect(mobileEditorFileFrom({ path: 'x.md', root: '/own' }, '/active')?.root).toBe('/own');
  });

  test('an empty body is a body, not a missing field', () => {
    expect(mobileEditorFileFrom({ path: 'empty.txt', content: '' })?.content).toBe('');
  });

  test('a payload naming no file produces nothing', () => {
    expect(mobileEditorFileFrom({})).toBeNull();
    expect(mobileEditorFileFrom({ path: '' })).toBeNull();
    expect(mobileEditorFileFrom({ path: '/' })).toBeNull();
    expect(mobileEditorFileFrom(null)).toBeNull();
    expect(mobileEditorFileFrom('a string')).toBeNull();
    expect(mobileEditorFileFrom({ path: 42 })).toBeNull();
  });

  test('a non-string field is dropped rather than rendered', () => {
    const result = mobileEditorFileFrom({ path: 'x.md', name: 7, repo: { nested: true }, handleId: 9 });
    expect(result?.name).toBe('x.md');
    expect(result?.repo).toBeUndefined();
    expect(result?.handleId).toBeUndefined();
  });
});
