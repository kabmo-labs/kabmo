/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * `getToolInputPath` / `getToolInputAction` are the only readers of a tool
 * call's raw arguments, which omp sends as an object but the MOCK path sends as
 * a JSON string. Both helpers must answer `undefined` for anything that is not
 * a string field — a JSON-string payload must not be parsed, and a numeric
 * `path` must not be coerced — because the panels fall back to `tool.target` /
 * `tool.title` on `undefined`, and a wrong truthy value silently paints the
 * wrong file or action.
 *
 * Pure functions, no mounting.
 */

import { describe, expect, test } from 'bun:test';
import {
  getToolInputAction,
  getToolInputPath,
} from '@/client/components/workspace/chat-timeline/tool-renderers/shared/tool-input';

describe('getToolInputPath', () => {
  test('reads the path off an object input', () => {
    expect(getToolInputPath({ path: 'src/a.ts' })).toBe('src/a.ts');
  });

  test('returns undefined for the MOCK path, which sends a JSON string', () => {
    expect(getToolInputPath('{"path":"src/a.ts"}')).toBeUndefined();
  });

  test('returns undefined when path is absent or not a string', () => {
    expect(getToolInputPath({})).toBeUndefined();
    expect(getToolInputPath({ path: 42 })).toBeUndefined();
    expect(getToolInputPath(undefined)).toBeUndefined();
    expect(getToolInputPath(null as never)).toBeUndefined();
  });
});

describe('getToolInputAction', () => {
  test('reads the action off an object input', () => {
    expect(getToolInputAction({ action: 'init' })).toBe('init');
  });

  test('returns undefined for a JSON-string input', () => {
    expect(getToolInputAction('{"action":"init"}')).toBeUndefined();
  });

  test('returns undefined when action is absent or not a string', () => {
    expect(getToolInputAction({})).toBeUndefined();
    expect(getToolInputAction({ action: 1 })).toBeUndefined();
    expect(getToolInputAction(undefined)).toBeUndefined();
  });
});
