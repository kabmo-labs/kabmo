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
import { acpContentText, acpToolDetails, acpToolOutput, acpToolTarget } from '@/server/lib/harness/acp/mapper';

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

  test('opencode puts the text under metadata.output', () => {
    expect(acpToolOutput({ metadata: { output: 'from metadata' } })).toBe('from metadata');
  });

  test('a generic command result joins stdout and stderr', () => {
    expect(acpToolOutput({ exitCode: 0, stdout: 'out\n', stderr: 'err' })).toBe('out\nerr');
    expect(acpToolOutput({ stderr: 'only err' })).toBe('only err');
    expect(acpToolOutput({ output_for_prompt: 'prompt text' })).toBe('prompt text');
  });

  test('opencode command metadata becomes the details the Bash panel reads', () => {
    expect(acpToolDetails({ metadata: { exit: 1, truncated: true, status: 'completed' } }))
      .toEqual({ exitCode: 1, truncated: true });
    expect(acpToolDetails({ metadata: { exit: 0, timeout: true, signal: 'SIGTERM' } }))
      .toEqual({ exitCode: 0, timedOut: true, signal: 'SIGTERM' });
  });

  test('a generic command result carries its exit status', () => {
    expect(acpToolDetails({ exit_code: 2, timed_out: true })).toEqual({ exitCode: 2, timedOut: true });
  });

  test('opencode file metadata becomes the diff the Edit panel reads', () => {
    const details = acpToolDetails({
      metadata: { files: [{ file: 'src/a.ts', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n-a\n+b' }] },
    });
    expect(details?.path).toBe('src/a.ts');
    expect(details?.diff).toContain('-a');
    expect(details?.diff).toContain('+b');
  });

  test('an explicit details bag wins over the inferred command shape', () => {
    expect(acpToolDetails({ details: { exitCode: 0 }, exit: 1 })).toEqual({ exitCode: 0 });
  });

  test('a bag with nothing recognizable yields no details', () => {
    expect(acpToolDetails({ metadata: { status: 'completed' } })).toBeUndefined();
    expect(acpToolDetails(undefined)).toBeUndefined();
  });

  test('target prefers locations, then the input bag', () => {
    expect(acpToolTarget([{ path: '/a' }], { path: 'b' })).toBe('/a');
    expect(acpToolTarget(undefined, { command: 'ls -la' })).toBe('ls -la');
    expect(acpToolTarget(undefined, undefined)).toBeUndefined();
  });
});
