/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The version table, as facts rather than a screenshot.
 *
 * The bug this pins was measured in a running card: `claude` read
 * "0.100.0 → 2.1.318" with an Update button, because the registry package was a
 * DIFFERENT product from the one the probe reported. A comparison across two
 * number lines is worse than no comparison — it invites an install that cannot
 * land where the number claims.
 *
 * The other half is what each kind of harness may be TOLD. A row with no probe
 * has no running version, and saying "up to date" about it would be fabricating a
 * fact; a self-updating CLI has no registry number at all, so the row states the
 * command instead.
 */

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isolateDb, releaseDb } from '@/test-support/isolated-db';
import { probes } from '@/server/lib/harness/probe-cache.server';
import { harnessVersionRows } from '@/server/routes/harness/versions';
import { isNewer } from '@/shared/lib/updates/semver';

beforeEach(async () => {
  await isolateDb();
  probes().clear();
});

afterEach(async () => {
  await releaseDb();
  probes().clear();
});

afterAll(async () => {
  await releaseDb();
});

/** The row for one harness. */
async function row(id: string) {
  const rows = await harnessVersionRows();
  const found = rows.find((entry) => entry.id === id);
  if (!found) throw new Error(`no row for ${id}`);
  return found;
}

describe('harness version rows', () => {
  test('an unprobed harness reports NO version and says so', async () => {
    const claude = await row('claude');
    // `false` here would claim "up to date" about an unknown version.
    expect(claude.agent.updateAvailable).toBe(false);
    expect(claude.note).toContain('Not probed');
  });

  test('a harness that is NOT installed offers no version and no action', async () => {
    // Measured on a real card: rows for agents that were never installed showed
    // an Update or a copyable command. An absent agent has nothing to update.
    const cursor = await row('cursor');
    if (!cursor.installed) {
      expect(cursor.kind).toBeNull();
      expect(cursor.agent.latest).toBeNull();
      expect(cursor.updateAvailable).toBe(false);
      expect(cursor.command).toBeNull();
      expect(cursor.note).toContain('Not installed');
    }
  });

  test('a self-updating harness has no registry number, only its command', async () => {
    const opencode = await row('opencode');
    // `kind` is reported only for a harness this machine can launch (`toRow`
    // nulls it otherwise), and `opencode` is not installed on a clean runner —
    // measured on both CI gates, where this case alone failed with
    // `Expected: "self", Received: null` while the same file passed locally.
    // The other cases here guard the same way; this one did not.
    if (!opencode.installed) return;
    expect(opencode.kind).toBe('self');
    expect(opencode.agent.latest).toBeNull();
    expect(opencode.command).toBe('opencode upgrade');
  });

  test('a vendor-managed harness carries its command ONLY when installed', async () => {
    // The command is what WOULD update it, so it is useful on an install and
    // misleading on an absent agent — a reader would copy a line that cannot run.
    const antigravity = await row('antigravity');
    if (antigravity.installed) {
      expect(antigravity.kind).toBe('own');
      expect(antigravity.command).toContain('antigravity.google');
    } else {
      expect(antigravity.kind).toBeNull();
      expect(antigravity.command).toBeNull();
      expect(antigravity.note).toContain('Not installed');
    }
    // Nothing for Kabmo to install either way.
    expect(antigravity.updateAvailable).toBe(false);
  });

  test('an installed npm harness reads a real registry version', async () => {
    // A network read, so it asserts only what it can: an INSTALLED npm harness
    // either has a version or says why the registry could not be read.
    const rows = await harnessVersionRows();
    const target = rows.find((entry) => entry.installed && entry.kind === 'npm');
    if (!target) return;
    if (target.agent.latest === null) {
      expect(target.note).toContain('Could not read');
      return;
    }
    expect(target.agent.latest).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('an adapter row reports BOTH parts, each with its own latest', async () => {
    // `claude` is an npm adapter over a `claude update` CLI. The row must carry
    // both numbers so the table can say which half is behind — a single flattened
    // pair is what made "the adapter is current" read as "everything is current".
    const claude = await row('claude');
    if (!claude.installed) return;
    expect(claude.cli?.name).toBe('Claude Code');
    // The registry answers are cached for ten minutes; a miss is stated as a null
    // rather than invented, so this asserts the shape and the comparison rule.
    for (const part of [claude.agent, claude.cli]) {
      if (!part) continue;
      expect(part.updateAvailable).toBe(
        Boolean(part.version && part.latest) && isNewer(part.latest as string, part.version as string),
      );
    }
    // `updateAvailable` is the union of the parts: one press moves every part that
    // is behind, so the button appears when either half can move.
    expect(claude.updateAvailable).toBe(claude.agent.updateAvailable || Boolean(claude.cli?.updateAvailable));
  });

  test('the built-in transport has no kind and no version', async () => {
    const builtin = await row('omp-rpc');
    expect(builtin.kind).toBeNull();
    expect(builtin.agent.version).toBeNull();
    expect(builtin.agent.latest).toBeNull();
    expect(builtin.cli).toBeNull();
    expect(builtin.updateAvailable).toBe(false);
  });

  test('every listed harness has a row, so a reader counts them all', async () => {
    const rows = await harnessVersionRows();
    expect(rows.length).toBeGreaterThan(10);
    for (const entry of rows) {
      expect(entry.label).toBeTruthy();
    }
  });
});
