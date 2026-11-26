/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `additionalDirectories` is only sent when the agent advertised it.
 *
 * The gate is the point: the field is a v2 capability, and an agent that does
 * not advertise it must not receive it — at best the key is ignored, at worst the
 * whole setup request is refused and no chat starts at all.
 */

import { describe, expect, test } from 'bun:test';
import { additionalDirectoriesFor } from './session-roots.server';

describe('additionalDirectoriesFor', () => {
  test('sends the extra roots when the agent advertised the capability', () => {
    expect(additionalDirectoriesFor(['/work/repo', '/work/repo-a'], '/work/repo-a', true)).toEqual({
      additionalDirectories: ['/work/repo'],
    });
  });

  test('sends nothing when the capability is absent', () => {
    expect(additionalDirectoriesFor(['/work/repo', '/work/repo-a'], '/work/repo-a', false)).toEqual({});
  });

  test('sends nothing when the session has only its own root', () => {
    expect(additionalDirectoriesFor(['/work/repo'], '/work/repo', true)).toEqual({});
  });
});
