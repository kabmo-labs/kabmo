/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which harnesses read the same registry file.
 *
 * The bug this pins: a provider added on the `omp-acp` tab was written to the
 * one `models.yml` both transports read, but only the clicked tab's probe was
 * dropped — so the other picker kept serving the pre-write catalog until its
 * TTL expired. The relation therefore has to be derived from the FILE the
 * harness reads, not from a hand-written pair that a third transport would miss.
 */

import { describe, expect, test } from 'bun:test';
import { registryFilePath, harnessesSharingRegistry } from '@/server/lib/harness/provider-sources.server';

describe('harnesses that share a registry file', () => {
  test('both omp transports read the same models.yml', () => {
    const modelsYml = registryFilePath('omp-rpc');
    expect(modelsYml).not.toBeNull();
    // Measured on the real facts table: omp-acp reads the same file omp-rpc does.
    expect(registryFilePath('omp-acp')).toBe(modelsYml);
    expect(harnessesSharingRegistry(modelsYml!).sort()).toEqual(['omp-acp', 'omp-rpc']);
  });

  test('a harness with its own file names only itself', () => {
    const codex = registryFilePath('codex');
    expect(codex).not.toBeNull();
    expect(harnessesSharingRegistry(codex!)).toEqual(['codex']);
  });

  test('a path no harness reads invalidates nothing', () => {
    // A caller that wrote some other file must not blank an unrelated picker.
    expect(harnessesSharingRegistry(`${registryFilePath('omp-rpc')}.bak`)).toEqual([]);
  });

  test('harnesses without a registry never appear', () => {
    // `minimax` has no file (`registry.file === null`); it must not match the
    // home directory merely because both strings are empty.
    expect(registryFilePath('minimax')).toBeNull();
    expect(harnessesSharingRegistry('')).toEqual([]);
  });
});
