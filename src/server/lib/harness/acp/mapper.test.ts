/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pure ACP content helpers the mapper feeds the renderers with.
 *
 * Split from `frames.test.ts` when the v2 cases pushed that file past the line
 * ceiling; these cases do not need the accumulator.
 */

import { describe, expect, test } from 'bun:test';
import { acpContentText, acpToolOutput, acpToolTarget } from '@/server/lib/harness/acp/mapper';

describe('acp mapper helpers', () => {
  test('both measured content shapes yield text', () => {
    expect(acpContentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('a\nb');
    expect(acpContentText([{ type: 'content', content: { type: 'text', text: 'wrapped' } }])).toBe('wrapped');
    expect(acpContentText('plain')).toBe('plain');
    // MCP-style tool output: the embedded text is readable, a link is named.
    expect(acpContentText([{ type: 'resource', resource: { uri: 'file:///a.txt', text: 'hello' } }])).toBe('hello');
    expect(acpContentText([{ type: 'resource', resource: { uri: 'file:///a.bin', blob: 'AA==' } }]))
      .toBe('[binary resource file:///a.bin]');
    expect(acpContentText([{ type: 'resource_link', uri: 'file:///a.md', name: 'a.md' }]))
      .toBe('a.md (file:///a.md)');
  });

  test('rawOutput keeps omp-shaped fallbacks', () => {
    expect(acpToolOutput({ content: [{ type: 'text', text: 'x' }] })).toBe('x');
    expect(acpToolOutput({ output: 'y' })).toBe('y');
    expect(acpToolOutput(null)).toBe('');
  });

  test('target prefers locations, then the input bag', () => {
    expect(acpToolTarget([{ path: '/a' }], { path: 'b' })).toBe('/a');
    expect(acpToolTarget(undefined, { command: 'ls -la' })).toBe('ls -la');
    expect(acpToolTarget(undefined, undefined)).toBeUndefined();
  });
});
