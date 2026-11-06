/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Version state for every harness, and how each one updates.
 *
 * The failure this prevents is a FABRICATED comparison. The first version of the
 * table pointed `claude` at `@anthropic-ai/claude-code` while the probe reports
 * `@agentclientprotocol/claude-agent-acp`: measured on a real probe, that read
 * "0.100.0 → 2.1.318", an update across two unrelated number lines. Numbers that
 * look comparable but are not are worse than a dash.
 *
 * So the cases are about kinds of knowledge:
 *
 *  - `npm` — a registry read is a real answer, and the comparison needs BOTH
 *    numbers. One missing is `—`, never "up to date".
 *  - `self` — the CLI owns its updater; Kabmo must not install a package behind
 *    the vendor's launcher, so the fact is the COMMAND.
 *  - `own` — a vendor installer owns it, and the route refuses with the reason.
 */

import { describe, expect, test } from 'bun:test';
import {
  HARNESS_UPDATE_FACTS,
  harnessUpdateFacts,
  latestBasis,
  latestSourceFor,
} from '@/shared/lib/harness/updates';
import { HARNESS_IDS } from '@/shared/lib/harness/catalog';

describe('update facts per harness', () => {
  test('every harness this build lists has facts', () => {
    for (const id of HARNESS_IDS) {
      // `omp-rpc` is the built-in transport: no agent, nothing to update.
      if (id === 'omp-rpc') continue;
      expect(HARNESS_UPDATE_FACTS[id], `no update facts for ${id}`).toBeDefined();
    }
  });

  test('the npm package is the one the PROBE reports, not a neighbouring one', () => {
    // `claude` probed as @agentclientprotocol/claude-agent-acp 0.100.0. Pointing
    // the table at @anthropic-ai/claude-code compared 0.100 against 2.1.
    expect(latestSourceFor('claude')).toBe('@agentclientprotocol/claude-agent-acp');
    expect(latestSourceFor('codex')).toBe('@agentclientprotocol/codex-acp');
  });

  test('a retired harness has no update facts, so nothing is offered', () => {
    // `opencode2` is gone from the catalog: the 2.x preview became a shim for
    // `opencode`. A stale row naming it must find no facts rather than a package.
    expect(harnessUpdateFacts('opencode2')).toBeNull();
    expect(latestSourceFor('opencode2')).toBeNull();
  });

  test('a self-updating CLI has NO registry source', () => {
    // Asking npm about `opencode` would invent a discrepancy between two number
    // lines; the vendor's `upgrade` is the only truthful answer.
    expect(latestSourceFor('opencode')).toBeNull();
    expect(latestBasis('opencode')).toBe('self');
    expect(harnessUpdateFacts('opencode')?.command).toBe('opencode upgrade');
    expect(harnessUpdateFacts('command-code')?.command).toBe('cmd update');
  });

  test('a vendor-installed harness is marked as not Kabmo’s to replace', () => {
    expect(harnessUpdateFacts('antigravity')?.kind).toBe('own');
    expect(harnessUpdateFacts('cursor')?.kind).toBe('own');
    // It still carries the command, so the UI can show what WOULD update it.
    expect(harnessUpdateFacts('antigravity')?.command).toContain('antigravity.google');
  });

  test('omp-acp defers to the Oh-My-Pi entry', () => {
    // Same agent, same installer: two buttons for one binary is how a reader
    // updates the same thing twice and cannot tell which one took effect.
    expect(harnessUpdateFacts('omp-acp')?.kind).toBe('self');
    expect(harnessUpdateFacts('omp-acp')?.command).toBe('omp update');
  });

  test('an unknown harness has no facts at all', () => {
    expect(harnessUpdateFacts('some-future-agent')).toBeNull();
    expect(latestSourceFor('some-future-agent')).toBeNull();
    expect(latestBasis(null)).toBe('unknown');
  });
});
