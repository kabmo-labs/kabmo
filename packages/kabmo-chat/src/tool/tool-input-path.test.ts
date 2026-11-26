/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The path a tool call names its file under, across adapters.
 *
 * Measured spellings: omp and opencode `path`, claude-code-acp `file_path`
 * (Read/Edit/Write reporters), omp legacy tools `TargetFile`/`AbsolutePath`,
 * the MOCK path `filePath`. Reading one spelling per renderer is what left a
 * claude Read card with no file and an Edit card headed "File modification".
 */

import { describe, expect, test } from 'bun:test';
import { TOOL_PATH_KEYS, toolInputPath } from './tool-input-path';

describe('toolInputPath', () => {
  test('reads every measured spelling', () => {
    expect(toolInputPath({ path: 'a.ts' })).toBe('a.ts');
    expect(toolInputPath({ file_path: '/tmp/b.ts' })).toBe('/tmp/b.ts');
    expect(toolInputPath({ filePath: 'c.ts' })).toBe('c.ts');
    expect(toolInputPath({ TargetFile: 'd.ts' })).toBe('d.ts');
    expect(toolInputPath({ AbsolutePath: '/e.ts' })).toBe('/e.ts');
    expect(toolInputPath({ absolute_path: '/f.ts' })).toBe('/f.ts');
    expect(toolInputPath({ notebook_path: 'n.ipynb' })).toBe('n.ipynb');
  });

  test('prefers the plain key when a call carries several', () => {
    expect(toolInputPath({ file_path: 'snake.ts', path: 'plain.ts' })).toBe('plain.ts');
  });

  test('ignores an empty, non-string or absent value', () => {
    expect(toolInputPath({ path: '' })).toBeUndefined();
    expect(toolInputPath({ path: 42 })).toBeUndefined();
    expect(toolInputPath(undefined)).toBeUndefined();
    expect(toolInputPath('a.ts')).toBeUndefined();
    expect(toolInputPath(['a.ts'])).toBeUndefined();
  });

  test('the key list has no duplicates', () => {
    expect(new Set(TOOL_PATH_KEYS).size).toBe(TOOL_PATH_KEYS.length);
  });
});
